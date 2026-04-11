import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { BrowserActionableElement, BrowserFormFieldModel, BrowserFormModel } from '../../shared/types/browserIntelligence';
import { WebIntentAdapter, WebIntentVM } from './WebIntentVM';

class JsdomIntentAdapter implements WebIntentAdapter {
  private dom: JSDOM | null = null;
  private readonly tabId = 'test-tab';
  private readonly fixturePath: string;

  constructor(fixturePath: string) {
    this.fixturePath = fixturePath;
  }

  async navigate(url: string): Promise<void> {
    const html = fs.readFileSync(this.fixturePath, 'utf-8');
    this.dom = new JSDOM(html, {
      url,
      runScripts: 'dangerously',
      resources: 'usable',
      pretendToBeVisual: true,
    });
    await this.waitForSettled(20);
  }

  async waitForSettled(timeoutMs = 20): Promise<void> {
    const delay = Math.min(Math.max(0, timeoutMs), 20);
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async getCurrentUrl(): Promise<string> {
    return this.window().location.href;
  }

  async readPageState(): Promise<{ url: string; title: string; text: string; mainHeading?: string }> {
    const w = this.window();
    const d = w.document;
    return {
      url: w.location.href,
      title: d.title || '',
      text: (d.body?.textContent || '').replace(/\s+/g, ' ').trim(),
      mainHeading: (d.querySelector('h1')?.textContent || '').trim(),
    };
  }

  async getActionableElements(): Promise<BrowserActionableElement[]> {
    const d = this.window().document;
    const nodes = Array.from(d.querySelectorAll('button, a[href], [role="button"], input[type="submit"]'));
    return nodes.map((node, index): BrowserActionableElement => {
      const tagName = node.tagName.toLowerCase();
      const selector = selectorFor(node);
      return {
        id: `act_${index}`,
        ref: { tabId: this.tabId, frameId: null, selector },
        role: node.getAttribute('role') || (tagName === 'button' ? 'button' : ''),
        tagName,
        text: (node.textContent || '').replace(/\s+/g, ' ').trim(),
        ariaLabel: node.getAttribute('aria-label') || '',
        href: node.getAttribute('href'),
        boundingBox: null,
        actionability: ['clickable'],
        visible: true,
        enabled: !(node as HTMLButtonElement).disabled,
        confidence: 1,
      };
    });
  }

  async getFormModel(): Promise<BrowserFormModel[]> {
    const d = this.window().document;
    const forms = Array.from(d.querySelectorAll('form'));
    return forms.map((form, index): BrowserFormModel => {
      const fields = Array.from(form.querySelectorAll('input, textarea, select'))
        .map((field, fieldIndex): BrowserFormFieldModel => {
          const tag = field.tagName.toLowerCase();
          const inputType = tag === 'input' ? (((field as HTMLInputElement).type || 'text').toLowerCase()) : tag;
          const label = (field.getAttribute('aria-label')
            || (field.id ? d.querySelector(`label[for="${field.id}"]`)?.textContent : '')
            || field.getAttribute('placeholder')
            || field.getAttribute('name')
            || '').trim();
          return {
            id: `field_${index}_${fieldIndex}`,
            ref: { tabId: this.tabId, frameId: null, selector: selectorFor(field) },
            kind: toFieldKind(inputType),
            label,
            name: field.getAttribute('name') || '',
            placeholder: field.getAttribute('placeholder') || '',
            required: field.hasAttribute('required'),
            visible: true,
            valuePreview: ('value' in field ? String((field as HTMLInputElement).value || '') : '').slice(0, 60),
          };
        });

      const submitLabels = Array.from(form.querySelectorAll('button, input[type="submit"]'))
        .map((node) => {
          if (node instanceof this.window().HTMLInputElement) return node.value;
          return node.textContent || '';
        })
        .map(text => text.trim())
        .filter(Boolean);

      return {
        id: `form_${index}`,
        formRef: { tabId: this.tabId, frameId: null, selector: selectorFor(form) },
        purpose: (form.getAttribute('aria-label') || form.id || 'unknown').toLowerCase(),
        method: (form.getAttribute('method') || 'GET').toUpperCase(),
        action: form.getAttribute('action') || '',
        fields,
        submitLabels,
      };
    });
  }

  async click(selector: string): Promise<{ clicked: boolean; error: string | null }> {
    const d = this.window().document;
    const node = d.querySelector(selector);
    if (!(node instanceof this.window().HTMLElement)) {
      return { clicked: false, error: `Element not found: ${selector}` };
    }
    node.click();
    return { clicked: true, error: null };
  }

  async type(selector: string, text: string): Promise<{ typed: boolean; error: string | null }> {
    const w = this.window();
    const d = w.document;
    const node = d.querySelector(selector);
    if (!(node instanceof w.HTMLInputElement || node instanceof w.HTMLTextAreaElement || node instanceof w.HTMLSelectElement)) {
      return { typed: false, error: `Type target not found: ${selector}` };
    }
    (node as HTMLInputElement).value = text;
    node.dispatchEvent(new w.Event('input', { bubbles: true }));
    node.dispatchEvent(new w.Event('change', { bubbles: true }));
    return { typed: true, error: null };
  }

  async executeInPage(expression: string): Promise<{ result: unknown; error: string | null }> {
    try {
      const result = this.window().eval(expression);
      return { result, error: null };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private window(): Window {
    if (!this.dom) throw new Error('No DOM loaded. Call navigate first.');
    return this.dom.window as unknown as Window;
  }
}

function selectorFor(node: Element): string {
  if (node.id) return `#${cssEscape(node.id)}`;
  const tag = node.tagName.toLowerCase();
  const parent = node.parentElement;
  if (!parent) return tag;
  const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
  const index = siblings.indexOf(node) + 1;
  return `${selectorFor(parent)} > ${tag}:nth-of-type(${index})`;
}

function cssEscape(value: string): string {
  return value.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, '\\$1');
}

function toFieldKind(inputType: string): BrowserFormFieldModel['kind'] {
  switch (inputType) {
    case 'text':
    case 'email':
    case 'password':
    case 'search':
    case 'tel':
    case 'url':
    case 'number':
    case 'checkbox':
    case 'radio':
      return inputType;
    case 'select':
    case 'textarea':
      return inputType;
    default:
      return 'unknown';
  }
}

describe('WebIntentVM', () => {
  it('runs a semantic login/upload/checkout/extract program on a website fixture', async () => {
    const fixturePath = path.join(process.cwd(), 'demo-app/public/intent-lab.html');
    const adapter = new JsdomIntentAdapter(fixturePath);
    const vm = new WebIntentVM(adapter);

    const result = await vm.run({
      instructions: [
        { op: 'NAVIGATE', args: { url: 'https://intent-lab.local/intent-lab.html' } },
        { op: 'INTENT.LOGIN', args: { email: 'demo@example.com', password: 'demo123' } },
        { op: 'ASSERT', args: { kind: 'logged_in' } },
        { op: 'INTENT.UPLOAD', args: { filePath: '/tmp/orders.csv' } },
        { op: 'INTENT.CHECKOUT' },
        { op: 'INTENT.EXTRACT', args: { fields: ['Order ID', 'Uploaded File', 'Status'] } },
        { op: 'ASSERT', args: { kind: 'text_present', text: 'Order complete' } },
      ],
      failFast: true,
    });

    expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
    expect(result.failedAt).toBeNull();
    expect(result.steps.every(step => step.status === 'ok')).toBe(true);
    expect(result.extracted.length).toBe(1);
    const extracted = result.extracted[0] || {};
    const selected = (extracted.selected || {}) as Record<string, string>;
    expect(selected['Order ID']).toBe('A100');
    expect(selected['Uploaded File']).toBe('/tmp/orders.csv');
    expect(selected.Status).toBe('Order complete');
  });
});
