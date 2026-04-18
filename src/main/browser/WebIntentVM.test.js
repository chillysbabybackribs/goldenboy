"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const jsdom_1 = require("jsdom");
const WebIntentVM_1 = require("./WebIntentVM");
class JsdomIntentAdapter {
    dom = null;
    tabId = 'test-tab';
    fixturePath;
    pendingDialogs = [];
    constructor(fixturePath) {
        this.fixturePath = fixturePath;
    }
    async navigate(url) {
        const html = fs.readFileSync(this.fixturePath, 'utf-8');
        this.dom = new jsdom_1.JSDOM(html, {
            url,
            runScripts: 'dangerously',
            resources: 'usable',
            pretendToBeVisual: true,
        });
        this.pendingDialogs = [];
        this.seedDialogFromUrl(url);
        await this.waitForSettled(20);
    }
    async waitForSettled(timeoutMs = 20) {
        const delay = Math.min(Math.max(0, timeoutMs), 20);
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    async getCurrentUrl() {
        return this.window().location.href;
    }
    async readPageState() {
        const w = this.window();
        const d = w.document;
        return {
            url: w.location.href,
            title: d.title || '',
            text: readableText(d.body),
            mainHeading: (d.querySelector('h1')?.textContent || '').trim(),
        };
    }
    async getDialogs() {
        return this.pendingDialogs.map(dialog => ({ ...dialog }));
    }
    async acceptDialog(input) {
        const dialog = this.resolveDialog(input.dialogId);
        if (!dialog)
            return { accepted: false, error: 'No pending dialog to accept' };
        this.pendingDialogs = this.pendingDialogs.filter(item => item.id !== dialog.id);
        this.applyDialogResolution(dialog, true, input.promptText);
        return { accepted: true, error: null };
    }
    async dismissDialog(input) {
        const dialog = this.resolveDialog(input.dialogId);
        if (!dialog)
            return { dismissed: false, error: 'No pending dialog to dismiss' };
        this.pendingDialogs = this.pendingDialogs.filter(item => item.id !== dialog.id);
        this.applyDialogResolution(dialog, false);
        return { dismissed: true, error: null };
    }
    async getActionableElements() {
        const d = this.window().document;
        const nodes = Array.from(d.querySelectorAll('button, a[href], [role="button"], input[type="submit"]'));
        return nodes.map((node, index) => {
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
                enabled: !node.disabled,
                confidence: 1,
            };
        });
    }
    async getFormModel() {
        const d = this.window().document;
        const forms = Array.from(d.querySelectorAll('form'));
        return forms.map((form, index) => {
            const fields = Array.from(form.querySelectorAll('input, textarea, select'))
                .map((field, fieldIndex) => {
                const tag = field.tagName.toLowerCase();
                const inputType = tag === 'input' ? ((field.type || 'text').toLowerCase()) : tag;
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
                    valuePreview: ('value' in field ? String(field.value || '') : '').slice(0, 60),
                };
            });
            const submitLabels = Array.from(form.querySelectorAll('button, input[type="submit"]'))
                .map((node) => {
                if (node instanceof this.window().HTMLInputElement)
                    return node.value;
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
    async click(selector) {
        const d = this.window().document;
        const node = d.querySelector(selector);
        if (!(node instanceof this.window().HTMLElement)) {
            return { clicked: false, error: `Element not found: ${selector}` };
        }
        node.click();
        return { clicked: true, error: null };
    }
    async type(selector, text) {
        const w = this.window();
        const d = w.document;
        const node = d.querySelector(selector);
        if (!(node instanceof w.HTMLInputElement || node instanceof w.HTMLTextAreaElement || node instanceof w.HTMLSelectElement)) {
            return { typed: false, error: `Type target not found: ${selector}` };
        }
        node.value = text;
        node.dispatchEvent(new w.Event('input', { bubbles: true }));
        node.dispatchEvent(new w.Event('change', { bubbles: true }));
        return { typed: true, error: null };
    }
    async upload(selector, filePath) {
        const result = await this.type(selector, filePath);
        return {
            uploaded: result.typed,
            error: result.error,
        };
    }
    async drag(sourceSelector, targetSelector) {
        const w = this.window();
        const d = w.document;
        const source = d.querySelector(sourceSelector);
        const target = d.querySelector(targetSelector);
        if (!(source instanceof w.Element)) {
            return { dragged: false, error: `Drag source not found: ${sourceSelector}` };
        }
        if (!(target instanceof w.Element)) {
            return { dragged: false, error: `Drop target not found: ${targetSelector}` };
        }
        const dataTransfer = {
            data: {},
            dropEffect: 'move',
            effectAllowed: 'all',
            files: [],
            items: [],
            types: [],
            clearData() {
                this.data = {};
                this.types = [];
            },
            getData(type) {
                return this.data[type] || '';
            },
            setData(type, value) {
                this.data[type] = value;
                if (!this.types.includes(type))
                    this.types.push(type);
            },
            setDragImage() { },
        };
        const dispatchDrag = (node, type) => {
            const event = new w.Event(type, { bubbles: true, cancelable: true });
            Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
            node.dispatchEvent(event);
        };
        dispatchDrag(source, 'dragstart');
        dispatchDrag(target, 'dragenter');
        dispatchDrag(target, 'dragover');
        dispatchDrag(target, 'drop');
        dispatchDrag(source, 'dragend');
        return { dragged: true, error: null };
    }
    async hover(selector) {
        const w = this.window();
        const d = w.document;
        const target = d.querySelector(selector);
        if (!(target instanceof w.Element)) {
            return { hovered: false, error: `Hover target not found: ${selector}` };
        }
        target.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new w.MouseEvent('mouseenter', { bubbles: true, cancelable: true }));
        target.dispatchEvent(new w.MouseEvent('mousemove', { bubbles: true, cancelable: true }));
        return { hovered: true, error: null };
    }
    async executeInPage(expression) {
        try {
            const result = this.window().eval(expression);
            return { result, error: null };
        }
        catch (err) {
            return { result: null, error: err instanceof Error ? err.message : String(err) };
        }
    }
    window() {
        if (!this.dom)
            throw new Error('No DOM loaded. Call navigate first.');
        return this.dom.window;
    }
    seedDialogFromUrl(url) {
        const parsed = new URL(url);
        const dialogType = parsed.searchParams.get('dialog');
        if (!dialogType)
            return;
        const message = parsed.searchParams.get('message') || `Fixture ${dialogType} dialog`;
        const defaultPrompt = parsed.searchParams.get('defaultPrompt') || '';
        this.pendingDialogs = [{
                id: `dialog_${dialogType}_0`,
                type: dialogType,
                message,
                defaultPrompt,
            }];
        this.updateDialogStatus(`Pending ${dialogType} dialog: ${message}`);
    }
    resolveDialog(dialogId) {
        if (dialogId) {
            return this.pendingDialogs.find(dialog => dialog.id === dialogId) || null;
        }
        return this.pendingDialogs[0] || null;
    }
    applyDialogResolution(dialog, accepted, promptText) {
        const d = this.window().document;
        const resultNode = d.querySelector('[data-label="Dialog Result"]');
        const typeNode = d.querySelector('[data-label="Dialog Type"]');
        const messageNode = d.querySelector('[data-label="Dialog Message"]');
        const promptNode = d.querySelector('[data-label="Prompt Value"]');
        if (typeNode)
            typeNode.textContent = dialog.type;
        if (messageNode)
            messageNode.textContent = dialog.message;
        let resultText = accepted ? 'Accepted dialog' : 'Dismissed dialog';
        let promptValue = '';
        if (dialog.type === 'alert') {
            resultText = 'You successfully clicked an alert';
        }
        else if (dialog.type === 'confirm') {
            resultText = accepted ? 'You clicked: Ok' : 'You clicked: Cancel';
        }
        else if (dialog.type === 'prompt') {
            promptValue = accepted ? (promptText ?? dialog.defaultPrompt ?? '') : '';
            resultText = accepted ? `You entered: ${promptValue}` : 'You entered: null';
        }
        if (resultNode)
            resultNode.textContent = resultText;
        if (promptNode)
            promptNode.textContent = promptValue || 'none';
        this.updateDialogStatus(resultText);
    }
    updateDialogStatus(text) {
        const d = this.window().document;
        const statusNode = d.getElementById('dialog-status');
        if (statusNode)
            statusNode.textContent = text;
    }
}
function selectorFor(node) {
    if (node.id)
        return `#${cssEscape(node.id)}`;
    const tag = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (!parent)
        return tag;
    const siblings = Array.from(parent.children).filter(child => child.tagName === node.tagName);
    const index = siblings.indexOf(node) + 1;
    return `${selectorFor(parent)} > ${tag}:nth-of-type(${index})`;
}
function cssEscape(value) {
    return value.replace(/([ #;?%&,.+*~\':"!^$[\]()=>|\/@])/g, '\\$1');
}
function toFieldKind(inputType) {
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
function readableText(root) {
    if (!root)
        return '';
    const cloned = root.cloneNode(true);
    cloned.querySelectorAll('script,style,noscript').forEach(node => node.remove());
    return (cloned.textContent || '').replace(/\s+/g, ' ').trim();
}
describe('WebIntentVM', () => {
    it('runs a semantic login/upload/checkout/extract program on a website fixture', async () => {
        const fixturePath = path.join(process.cwd(), 'demo-app/public/intent-lab.html');
        const adapter = new JsdomIntentAdapter(fixturePath);
        const vm = new WebIntentVM_1.WebIntentVM(adapter);
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
        const selected = (extracted.selected || {});
        expect(selected['Order ID']).toBe('A100');
        expect(selected['Uploaded File']).toBe('/tmp/orders.csv');
        expect(selected.Status).toBe('Order complete');
    });
    it('runs a semantic e-commerce checkout flow with add-to-cart/cart/checkout-info/finish ops', async () => {
        const fixturePath = path.join(process.cwd(), 'demo-app/public/checkout-lab.html');
        const adapter = new JsdomIntentAdapter(fixturePath);
        const vm = new WebIntentVM_1.WebIntentVM(adapter);
        const result = await vm.run({
            instructions: [
                { op: 'NAVIGATE', args: { url: 'https://intent-lab.local/checkout-lab.html' } },
                { op: 'INTENT.LOGIN', args: { username: 'standard_user', password: 'secret_sauce' } },
                { op: 'INTENT.ADD_TO_CART', args: { item: 'Sauce Labs Backpack' } },
                { op: 'INTENT.OPEN_CART' },
                { op: 'INTENT.CHECKOUT' },
                { op: 'INTENT.FILL_CHECKOUT_INFO', args: { firstName: 'Test', lastName: 'User', postalCode: '12345' } },
                { op: 'INTENT.FINISH_ORDER' },
                { op: 'ASSERT', args: { kind: 'text_present', text: 'Thank you for your order!' } },
                { op: 'ASSERT', args: { kind: 'url_includes', value: 'checkout-complete' } },
                { op: 'INTENT.EXTRACT', args: { fields: ['Order ID', 'Status'] } },
            ],
            failFast: true,
        });
        expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
        expect(result.failedAt).toBeNull();
        expect(result.steps.every(step => step.status === 'ok')).toBe(true);
        expect(result.extracted.length).toBe(1);
        const extracted = result.extracted[0] || {};
        const selected = (extracted.selected || {});
        expect(selected['Order ID']).toBe('ORD-4242');
        expect(selected.Status).toBe('Order complete');
    });
    it('runs a semantic drag/drop flow on a website fixture', async () => {
        const fixturePath = path.join(process.cwd(), 'demo-app/public/drag-lab.html');
        const adapter = new JsdomIntentAdapter(fixturePath);
        const vm = new WebIntentVM_1.WebIntentVM(adapter);
        const result = await vm.run({
            instructions: [
                { op: 'NAVIGATE', args: { url: 'https://intent-lab.local/drag-lab.html' } },
                { op: 'INTENT.DRAG_DROP', args: { source: 'circle', target: 'can', successText: 'Success: circle dropped in the can.' } },
                { op: 'ASSERT', args: { kind: 'text_present', text: 'Success: circle dropped in the can.' } },
            ],
            failFast: true,
        });
        expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
        expect(result.failedAt).toBeNull();
        expect(result.steps.every(step => step.status === 'ok')).toBe(true);
    });
    it('runs a semantic hover flow on a website fixture', async () => {
        const fixturePath = path.join(process.cwd(), 'demo-app/public/hover-lab.html');
        const adapter = new JsdomIntentAdapter(fixturePath);
        const vm = new WebIntentVM_1.WebIntentVM(adapter);
        const result = await vm.run({
            instructions: [
                { op: 'NAVIGATE', args: { url: 'https://intent-lab.local/hover-lab.html' } },
                { op: 'INTENT.HOVER', args: { target: 'first profile', successText: 'name: user1' } },
                { op: 'ASSERT', args: { kind: 'text_present', text: 'View profile' } },
            ],
            failFast: true,
        });
        expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
        expect(result.failedAt).toBeNull();
        expect(result.steps.every(step => step.status === 'ok')).toBe(true);
    });
    it('runs semantic dialog accept flow with prompt text on a website fixture', async () => {
        const fixturePath = path.join(process.cwd(), 'demo-app/public/dialog-lab.html');
        const adapter = new JsdomIntentAdapter(fixturePath);
        const vm = new WebIntentVM_1.WebIntentVM(adapter);
        const result = await vm.run({
            instructions: [
                {
                    op: 'NAVIGATE',
                    args: {
                        url: 'https://intent-lab.local/dialog-lab.html?dialog=prompt&message=Enter%20your%20name&defaultPrompt=Guest',
                    },
                },
                {
                    op: 'INTENT.ACCEPT_DIALOG',
                    args: {
                        messageContains: 'Enter your name',
                        promptText: 'Goldenboy',
                        successText: 'You entered: Goldenboy',
                    },
                },
                { op: 'ASSERT', args: { kind: 'text_present', text: 'You entered: Goldenboy' } },
            ],
            failFast: true,
        });
        expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
        expect(result.failedAt).toBeNull();
        expect(result.steps.every(step => step.status === 'ok')).toBe(true);
    });
    it('runs semantic dialog dismiss flow on a website fixture', async () => {
        const fixturePath = path.join(process.cwd(), 'demo-app/public/dialog-lab.html');
        const adapter = new JsdomIntentAdapter(fixturePath);
        const vm = new WebIntentVM_1.WebIntentVM(adapter);
        const result = await vm.run({
            instructions: [
                {
                    op: 'NAVIGATE',
                    args: {
                        url: 'https://intent-lab.local/dialog-lab.html?dialog=confirm&message=Delete%20item',
                    },
                },
                {
                    op: 'INTENT.DISMISS_DIALOG',
                    args: {
                        messageContains: 'Delete item',
                    },
                },
                { op: 'ASSERT', args: { kind: 'text_present', text: 'You clicked: Cancel' } },
            ],
            failFast: true,
        });
        expect(result.success, JSON.stringify(result, null, 2)).toBe(true);
        expect(result.failedAt).toBeNull();
        expect(result.steps.every(step => step.status === 'ok')).toBe(true);
    });
});
//# sourceMappingURL=WebIntentVM.test.js.map