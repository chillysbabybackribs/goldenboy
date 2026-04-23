import * as fs from 'fs';
import * as path from 'path';
import { AgentSkill, AgentToolName } from './AgentTypes';
import { resolveWorkspacePath } from '../workspaceRoot';

const SKILLS_DIR = resolveWorkspacePath('skills');

type CachedSkill = {
  skill: AgentSkill;
  mtimeMs: number;
};

export type SkillFrontmatter = {
  name?: string;
  description?: string;
  allowedTools?: string[];
  references?: string[];
};

export type ParsedSkillFile = {
  frontmatter: SkillFrontmatter;
  body: string;
};

/**
 * Parse the small YAML subset we expect inside SKILL.md frontmatter.
 *
 * Supported shapes:
 *
 *   name: code-edit
 *   description: One line of text.
 *   allowed-tools:
 *     - filesystem.read
 *     - filesystem.patch
 *   allowed-tools: [filesystem.read, filesystem.patch]
 *
 * Keys may use `kebab-case` or `camelCase` in the file; we normalize on read.
 * Anything more complex (nested maps, anchors, multi-line scalars) is
 * intentionally unsupported — skills should not need them.
 */
export function parseSkillFile(raw: string): ParsedSkillFile {
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  const frontmatter: SkillFrontmatter = {};
  const lines = match[1].split('\n');

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) {
      i += 1;
      continue;
    }
    const kv = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      i += 1;
      continue;
    }
    const key = normalizeFrontmatterKey(kv[1]);
    const inline = kv[2].trim();

    if (inline === '') {
      const listValues: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        const listMatch = /^\s+-\s+(.*)$/.exec(next);
        if (!listMatch) break;
        listValues.push(stripQuotes(listMatch[1].trim()));
        i += 1;
      }
      assignFrontmatterKey(frontmatter, key, listValues);
      continue;
    }

    const inlineList = /^\[(.*)\]$/.exec(inline);
    if (inlineList) {
      const listValues = inlineList[1]
        .split(',')
        .map((item) => stripQuotes(item.trim()))
        .filter(Boolean);
      assignFrontmatterKey(frontmatter, key, listValues);
      i += 1;
      continue;
    }

    assignFrontmatterKey(frontmatter, key, stripQuotes(inline));
    i += 1;
  }

  return { frontmatter, body: match[2] };
}

function normalizeFrontmatterKey(key: string): string {
  return key.toLowerCase().replace(/[_-]+/g, '');
}

function assignFrontmatterKey(
  frontmatter: SkillFrontmatter,
  normalizedKey: string,
  value: string | string[],
): void {
  if (normalizedKey === 'name' && typeof value === 'string') {
    frontmatter.name = value;
    return;
  }
  if (normalizedKey === 'description' && typeof value === 'string') {
    frontmatter.description = value;
    return;
  }
  if (normalizedKey === 'allowedtools' && Array.isArray(value)) {
    frontmatter.allowedTools = value;
    return;
  }
  if (normalizedKey === 'references' && Array.isArray(value)) {
    frontmatter.references = value;
    return;
  }
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export class AgentSkillLoader {
  private skillCache = new Map<string, CachedSkill>();

  listSkillNames(): string[] {
    if (!fs.existsSync(SKILLS_DIR)) return [];
    return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
  }

  /**
   * Load every skill on disk. Used to build the skill index (name +
   * description) that the model sees in the system prompt.
   */
  listSkills(): AgentSkill[] {
    return this.listSkillNames().map(name => this.loadSkill(name));
  }

  loadSkill(name: string): AgentSkill {
    const skillPath = path.join(SKILLS_DIR, name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) {
      throw new Error(`Skill not found: ${name}`);
    }
    const stat = fs.statSync(skillPath);
    const cached = this.skillCache.get(name);
    if (cached && cached.skill.path === skillPath && cached.mtimeMs === stat.mtimeMs) {
      return { ...cached.skill };
    }

    const raw = fs.readFileSync(skillPath, 'utf-8');
    const parsed = parseSkillFile(raw);
    const frontmatterName = parsed.frontmatter.name?.trim() || name;
    const description = parsed.frontmatter.description?.trim() ?? deriveDescriptionFromBody(parsed.body, name);
    const allowedTools = (parsed.frontmatter.allowedTools ?? []) as AgentToolName[];
    const references = parsed.frontmatter.references ?? [];

    const skill: AgentSkill = {
      name: frontmatterName,
      path: skillPath,
      body: parsed.body.trim(),
      description,
      allowedTools,
      references,
    };
    this.skillCache.set(name, { skill, mtimeMs: stat.mtimeMs });
    return { ...skill };
  }

  loadSkills(names: string[]): AgentSkill[] {
    return names.map(name => this.loadSkill(name));
  }
}

/**
 * Fallback description when a skill file lacks frontmatter. We take the first
 * non-heading, non-empty line of the body so the skill index still has
 * something meaningful to render.
 */
function deriveDescriptionFromBody(body: string, name: string): string {
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    return trimmed.length > 240 ? `${trimmed.slice(0, 237)}...` : trimmed;
  }
  return `Skill: ${name}`;
}

export const agentSkillLoader = new AgentSkillLoader();
