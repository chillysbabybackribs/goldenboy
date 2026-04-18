"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const preview_1 = require("./preview");
(0, vitest_1.describe)('document preview helpers', () => {
    (0, vitest_1.it)('renders headings and list items for markdown preview', () => {
        const html = (0, preview_1.renderMarkdownPreview)('# Title\n\n- One\n- Two');
        (0, vitest_1.expect)(html).toContain('<h1>Title</h1>');
        (0, vitest_1.expect)(html).toContain('<ul>');
        (0, vitest_1.expect)(html).toContain('<li>One</li>');
    });
    (0, vitest_1.it)('parses csv rows using newline and comma splits', () => {
        (0, vitest_1.expect)((0, preview_1.parseCsvRows)('name,value\r\nalpha,1\nbeta,2')).toEqual([
            ['name', 'value'],
            ['alpha', '1'],
            ['beta', '2'],
        ]);
    });
    (0, vitest_1.it)('builds sandboxed html with interaction disabled', () => {
        const doc = (0, preview_1.buildSandboxedHtmlDocument)('<a href=\"https://example.com\">Link</a>');
        (0, vitest_1.expect)(doc).toContain("default-src 'none'");
        (0, vitest_1.expect)(doc).toContain('pointer-events: none');
        (0, vitest_1.expect)(doc).toContain('<body><a href="https://example.com">Link</a></body>');
    });
});
//# sourceMappingURL=preview.test.js.map