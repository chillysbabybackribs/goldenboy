"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.chunkPage = chunkPage;
const PageCleaner_1 = require("./PageCleaner");
const MAX_CHUNK_CHARS = 1800;
const MIN_CHUNK_CHARS = 120;
function chunkPage(input) {
    const sections = splitSections(input.content);
    const chunks = [];
    let ordinal = 0;
    for (const section of sections) {
        for (const text of splitLongText(section.text, MAX_CHUNK_CHARS)) {
            const trimmed = text.trim();
            if (trimmed.length < MIN_CHUNK_CHARS && sections.length > 1)
                continue;
            chunks.push({
                id: `${input.pageId}_chunk_${ordinal}`,
                pageId: input.pageId,
                tabId: input.tabId,
                url: input.url,
                title: input.title,
                heading: section.heading,
                text: trimmed,
                ordinal,
                tokenEstimate: (0, PageCleaner_1.estimateTokens)(trimmed),
                createdAt: input.createdAt,
            });
            ordinal++;
        }
    }
    if (chunks.length === 0 && input.content.trim()) {
        const text = input.content.trim().slice(0, MAX_CHUNK_CHARS);
        chunks.push({
            id: `${input.pageId}_chunk_0`,
            pageId: input.pageId,
            tabId: input.tabId,
            url: input.url,
            title: input.title,
            heading: input.title,
            text,
            ordinal: 0,
            tokenEstimate: (0, PageCleaner_1.estimateTokens)(text),
            createdAt: input.createdAt,
        });
    }
    return chunks;
}
function splitSections(content) {
    const lines = content.split('\n');
    const sections = [];
    let current = { heading: '', text: [] };
    for (const line of lines) {
        const heading = line.match(/^#{1,3}\s+(.+)$/);
        if (heading) {
            if (current.text.join('\n').trim())
                sections.push(current);
            current = { heading: heading[1].trim(), text: [line] };
        }
        else {
            current.text.push(line);
        }
    }
    if (current.text.join('\n').trim())
        sections.push(current);
    return sections.map(section => ({ heading: section.heading, text: section.text.join('\n') }));
}
function splitLongText(text, maxChars) {
    if (text.length <= maxChars)
        return [text];
    const paragraphs = text.split(/\n\s*\n/);
    const chunks = [];
    let current = '';
    for (const paragraph of paragraphs) {
        if ((current + '\n\n' + paragraph).trim().length > maxChars && current.trim()) {
            chunks.push(current.trim());
            current = '';
        }
        if (paragraph.length > maxChars) {
            for (let i = 0; i < paragraph.length; i += maxChars) {
                chunks.push(paragraph.slice(i, i + maxChars));
            }
        }
        else {
            current = current ? `${current}\n\n${paragraph}` : paragraph;
        }
    }
    if (current.trim())
        chunks.push(current.trim());
    return chunks;
}
//# sourceMappingURL=PageChunker.js.map