import * as fs from 'fs';
import * as path from 'path';

export interface PageContent {
  url: string;
  title: string;
  content: string;
}

export interface PageElements {
  url: string;
  elements: unknown[];
  forms: unknown[];
}

export interface PageMeta {
  tabId: string;
  url: string;
  title: string;
}

export interface SearchResult extends PageMeta {
  matchingLines: string[];
}

export class DiskCache {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private pagesDir(taskId: string): string {
    return path.join(this.baseDir, taskId, 'pages');
  }

  private contentPath(taskId: string, tabId: string): string {
    return path.join(this.pagesDir(taskId), `${tabId}-content.md`);
  }

  private elementsPath(taskId: string, tabId: string): string {
    return path.join(this.pagesDir(taskId), `${tabId}-elements.json`);
  }

  private ensurePagesDir(taskId: string): void {
    fs.mkdirSync(this.pagesDir(taskId), { recursive: true });
  }

  private buildFrontmatter(fields: Record<string, string>): string {
    const lines = ['---'];
    for (const [key, value] of Object.entries(fields)) {
      lines.push(`${key}: ${value}`);
    }
    lines.push('---');
    return lines.join('\n');
  }

  private parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
    const meta: Record<string, string> = {};
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

  async writePageContent(taskId: string, tabId: string, data: PageContent): Promise<void> {
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

  async writePageElements(taskId: string, tabId: string, data: PageElements): Promise<void> {
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

  async searchPages(
    taskId: string,
    query: string,
    contextLines: number = 2,
  ): Promise<SearchResult[]> {
    const dir = this.pagesDir(taskId);
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('-content.md'));
    const results: SearchResult[] = [];
    // Split query into individual words — match if ANY word appears on a line
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length >= 2);
    if (queryWords.length === 0) return [];

    for (const file of files) {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const { meta, body } = this.parseFrontmatter(raw);

      const bodyLines = body.split('\n');
      const matchIndices: number[] = [];

      for (let i = 0; i < bodyLines.length; i++) {
        const lower = bodyLines[i].toLowerCase();
        if (queryWords.some(word => lower.includes(word))) {
          matchIndices.push(i);
        }
      }

      if (matchIndices.length === 0) continue;

      // Collect unique lines within context range
      const includedLines = new Set<number>();
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

  async readSection(
    taskId: string,
    tabId: string,
    sectionName: string,
  ): Promise<string | null> {
    const filePath = this.contentPath(taskId, tabId);
    if (!fs.existsSync(filePath)) return null;

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

    if (startIdx === -1) return null;

    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) {
        endIdx = i;
        break;
      }
    }

    return lines.slice(startIdx, endIdx).join('\n').trimEnd();
  }

  async listPages(taskId: string): Promise<PageMeta[]> {
    const dir = this.pagesDir(taskId);
    if (!fs.existsSync(dir)) return [];

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('-content.md'));
    const pages: PageMeta[] = [];

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

  async cleanup(taskId: string): Promise<void> {
    const taskDir = path.join(this.baseDir, taskId);
    if (fs.existsSync(taskDir)) {
      fs.rmSync(taskDir, { recursive: true, force: true });
    }
  }
}
