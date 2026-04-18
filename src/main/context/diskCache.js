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
exports.DiskCache = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class DiskCache {
    baseDir;
    constructor(baseDir) {
        this.baseDir = baseDir;
    }
    pagesDir(taskId) {
        return path.join(this.baseDir, taskId, 'pages');
    }
    contentPath(taskId, tabId) {
        return path.join(this.pagesDir(taskId), `${tabId}-content.md`);
    }
    elementsPath(taskId, tabId) {
        return path.join(this.pagesDir(taskId), `${tabId}-elements.json`);
    }
    ensurePagesDir(taskId) {
        fs.mkdirSync(this.pagesDir(taskId), { recursive: true });
    }
    buildFrontmatter(fields) {
        const lines = ['---'];
        for (const [key, value] of Object.entries(fields)) {
            lines.push(`${key}: ${value}`);
        }
        lines.push('---');
        return lines.join('\n');
    }
    parseFrontmatter(raw) {
        const meta = {};
        if (!raw.startsWith('---\n')) {
            return { meta, body: raw };
        }
        const endIdx = raw.indexOf('\n---\n', 4);
        if (endIdx === -1) {
            return { meta, body: raw };
        }
        const fmBlock = raw.slice(4, endIdx);
        for (const line of fmBlock.split('\n')) {
            const colonIdx = line.indexOf(': ');
            if (colonIdx > 0) {
                meta[line.slice(0, colonIdx)] = line.slice(colonIdx + 2);
            }
        }
        const body = raw.slice(endIdx + 5); // skip past \n---\n
        return { meta, body };
    }
    async writePageContent(taskId, tabId, data) {
        this.ensurePagesDir(taskId);
        const frontmatter = this.buildFrontmatter({
            url: data.url,
            title: data.title,
            tabId,
            extractedAt: new Date().toISOString(),
        });
        const fileContent = `${frontmatter}\n${data.content}\n`;
        fs.writeFileSync(this.contentPath(taskId, tabId), fileContent, 'utf-8');
    }
    async writePageElements(taskId, tabId, data) {
        this.ensurePagesDir(taskId);
        const payload = {
            url: data.url,
            tabId,
            extractedAt: new Date().toISOString(),
            elements: data.elements,
            forms: data.forms,
        };
        fs.writeFileSync(this.elementsPath(taskId, tabId), JSON.stringify(payload, null, 2), 'utf-8');
    }
    async searchPages(taskId, query, contextLines = 2) {
        const dir = this.pagesDir(taskId);
        if (!fs.existsSync(dir))
            return [];
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('-content.md'));
        const results = [];
        // Split query into individual words — match if ANY word appears on a line
        const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
        if (queryWords.length === 0)
            return [];
        for (const file of files) {
            const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
            const { meta, body } = this.parseFrontmatter(raw);
            const bodyLines = body.split('\n');
            const matchIndices = [];
            for (let i = 0; i < bodyLines.length; i++) {
                const lower = bodyLines[i].toLowerCase();
                if (queryWords.some(word => lower.includes(word))) {
                    matchIndices.push(i);
                }
            }
            if (matchIndices.length === 0)
                continue;
            // Collect unique lines within context range
            const includedLines = new Set();
            for (const idx of matchIndices) {
                const start = Math.max(0, idx - contextLines);
                const end = Math.min(bodyLines.length - 1, idx + contextLines);
                for (let j = start; j <= end; j++) {
                    includedLines.add(j);
                }
            }
            const sortedIndices = Array.from(includedLines).sort((a, b) => a - b);
            const matchingLines = sortedIndices.map((i) => bodyLines[i]);
            const tabId = file.replace(/-content\.md$/, '');
            results.push({
                tabId,
                url: meta.url || '',
                title: meta.title || '',
                matchingLines,
            });
        }
        return results;
    }
    async readSection(taskId, tabId, sectionName) {
        const filePath = this.contentPath(taskId, tabId);
        if (!fs.existsSync(filePath))
            return null;
        const raw = fs.readFileSync(filePath, 'utf-8');
        const { body } = this.parseFrontmatter(raw);
        const lines = body.split('\n');
        const lowerSection = sectionName.toLowerCase();
        let startIdx = -1;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('## ') && line.slice(3).toLowerCase().includes(lowerSection)) {
                startIdx = i;
                break;
            }
        }
        if (startIdx === -1)
            return null;
        let endIdx = lines.length;
        for (let i = startIdx + 1; i < lines.length; i++) {
            if (lines[i].startsWith('## ')) {
                endIdx = i;
                break;
            }
        }
        return lines.slice(startIdx, endIdx).join('\n').trimEnd();
    }
    async listPages(taskId) {
        const dir = this.pagesDir(taskId);
        if (!fs.existsSync(dir))
            return [];
        const files = fs.readdirSync(dir).filter((f) => f.endsWith('-content.md'));
        const pages = [];
        for (const file of files) {
            const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
            const { meta } = this.parseFrontmatter(raw);
            const tabId = file.replace(/-content\.md$/, '');
            pages.push({
                tabId,
                url: meta.url || '',
                title: meta.title || '',
            });
        }
        return pages;
    }
    async cleanup(taskId) {
        const taskDir = path.join(this.baseDir, taskId);
        if (fs.existsSync(taskDir)) {
            fs.rmSync(taskDir, { recursive: true, force: true });
        }
    }
}
exports.DiskCache = DiskCache;
//# sourceMappingURL=diskCache.js.map