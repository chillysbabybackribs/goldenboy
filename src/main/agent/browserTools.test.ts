import { vi } from 'vitest';

vi.mock('../browser/BrowserService', () => ({
  browserService: {
    executeInPage: vi.fn(),
    isCreated: vi.fn(() => true),
  },
}));

import { buildWaitForTextExpression } from './tools/browserTools';

describe('buildWaitForTextExpression', () => {
  it('includes form control values in the page text probe', () => {
    const expression = buildWaitForTextExpression();

    expect(expression).toContain("document.querySelectorAll('input, textarea, select')");
    expect(expression).toContain("'value' in element");
    expect(expression).toContain('element.selectedOptions');
    expect(expression).toContain('document.body?.innerText');
  });
});
