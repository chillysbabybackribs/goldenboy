"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanPageText = cleanPageText;
exports.estimateTokens = estimateTokens;
const BOILERPLATE_PATTERNS = [
    /accept all cookies/gi,
    /manage cookies/gi,
    /privacy policy/gi,
    /terms of service/gi,
    /subscribe to our newsletter/gi,
    /all rights reserved/gi,
];
function cleanPageText(input) {
    let text = input.replace(/\r/g, '\n');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n{3,}/g, '\n\n');
    for (const pattern of BOILERPLATE_PATTERNS) {
        text = text.replace(pattern, '');
    }
    const seen = new Set();
    const lines = [];
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line) {
            if (lines[lines.length - 1] !== '')
                lines.push('');
            continue;
        }
        const key = line.toLowerCase();
        if (line.length > 20 && seen.has(key))
            continue;
        seen.add(key);
        lines.push(line);
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
//# sourceMappingURL=PageCleaner.js.map