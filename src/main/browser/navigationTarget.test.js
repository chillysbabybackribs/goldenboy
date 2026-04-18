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
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const url_1 = require("url");
const navigationTarget_1 = require("./navigationTarget");
describe('normalizeNavigationTarget', () => {
    it('preserves explicit URLs', () => {
        const result = (0, navigationTarget_1.normalizeNavigationTarget)('https://example.com/docs', { searchEngine: 'google' });
        expect(result.kind).toBe('direct-url');
        expect(result.url).toBe('https://example.com/docs');
    });
    it('normalizes domain-only targets to https', () => {
        const result = (0, navigationTarget_1.normalizeNavigationTarget)('example.com/pricing', { searchEngine: 'google' });
        expect(result.kind).toBe('direct-url');
        expect(result.url).toBe('https://example.com/pricing');
    });
    it('converts unsupported URL schemes to search', () => {
        const result = (0, navigationTarget_1.normalizeNavigationTarget)('mailto:test@example.com', { searchEngine: 'google' });
        expect(result.kind).toBe('search');
        expect(result.url).toBe('https://www.google.com/search?q=mailto%3Atest%40example.com');
    });
    it('preserves explicit URLs with uppercase schemes', () => {
        const result = (0, navigationTarget_1.normalizeNavigationTarget)('HTTP://example.com/path', { searchEngine: 'google' });
        expect(result.kind).toBe('direct-url');
        expect(result.url).toBe('HTTP://example.com/path');
    });
    it('keeps explicit file URLs as direct targets', () => {
        const result = (0, navigationTarget_1.normalizeNavigationTarget)('file:///tmp/example.html', { searchEngine: 'google' });
        expect(result.kind).toBe('direct-url');
        expect(result.url).toBe('file:///tmp/example.html');
    });
    it('normalizes localhost and IP targets to http', () => {
        const localhost = (0, navigationTarget_1.normalizeNavigationTarget)('localhost:5173/dashboard', { searchEngine: 'google' });
        const loopback = (0, navigationTarget_1.normalizeNavigationTarget)('127.0.0.1:3000', { searchEngine: 'google' });
        expect(localhost.url).toBe('http://localhost:5173/dashboard');
        expect(loopback.url).toBe('http://127.0.0.1:3000');
    });
    it('resolves existing local file paths into file:// URLs', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-nav-target-'));
        const filePath = path.join(dir, 'index.html');
        fs.writeFileSync(filePath, '<h1>hello</h1>', 'utf-8');
        const result = (0, navigationTarget_1.normalizeNavigationTarget)(filePath, { searchEngine: 'google', cwd: dir });
        expect(result.kind).toBe('local-file');
        expect(result.url).toBe((0, url_1.pathToFileURL)(filePath).href);
    });
    it('resolves relative file paths when cwd is provided', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-nav-target-relative-'));
        const filePath = path.join(dir, 'local-page.html');
        fs.writeFileSync(filePath, '<h1>relative</h1>', 'utf-8');
        const result = (0, navigationTarget_1.normalizeNavigationTarget)('local-page.html', { searchEngine: 'google', cwd: dir });
        expect(result.kind).toBe('local-file');
        expect(result.url).toBe((0, url_1.pathToFileURL)(filePath).href);
    });
    it('falls back to search for plain text queries', () => {
        const result = (0, navigationTarget_1.normalizeNavigationTarget)('best coffee beans for espresso', { searchEngine: 'google' });
        expect(result.kind).toBe('search');
        expect(result.url).toContain('https://www.google.com/search?q=');
        expect(result.url).toContain('best%20coffee%20beans%20for%20espresso');
    });
});
//# sourceMappingURL=navigationTarget.test.js.map