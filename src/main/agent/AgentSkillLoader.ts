import * as fs from 'fs';
import * as path from 'path';
import { AgentSkill } from './AgentTypes';

const SKILLS_DIR = path.join(process.cwd(), 'skills');

type CachedSkill = {
  skill: AgentSkill;
  mtimeMs: number;
};

export class AgentSkillLoader {
  private skillCache = new Map<string, CachedSkill>();

  listSkillNames(): string[] {
    if (!fs.existsSync(SKILLS_DIR)) return [];
    return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
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

    const skill: AgentSkill = {
      name,
      path: skillPath,
      body: fs.readFileSync(skillPath, 'utf-8'),
    };
    this.skillCache.set(name, { skill, mtimeMs: stat.mtimeMs });
    return { ...skill };
  }

  loadSkills(names: string[]): AgentSkill[] {
    return names.map(name => this.loadSkill(name));
  }
}

export const agentSkillLoader = new AgentSkillLoader();
