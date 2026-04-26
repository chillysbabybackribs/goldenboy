import { describe, expect, it } from 'vitest';
import { agentSkillLoader, parseSkillFile } from './AgentSkillLoader';

describe('parseSkillFile', () => {
  it('parses scalar keys and multi-line list keys from YAML frontmatter', () => {
    const raw = [
      '---',
      'name: code-edit',
      'description: Use when any file change is required.',
      'allowed-tools:',
      '  - filesystem.read',
      '  - filesystem.patch',
      'references:',
      '  - src/main/agent/AgentRuntime.ts',
      '---',
      '',
      '# Code Edit',
      '',
      'Body text here.',
    ].join('\n');

    const parsed = parseSkillFile(raw);

    expect(parsed.frontmatter.name).toBe('code-edit');
    expect(parsed.frontmatter.description).toBe('Use when any file change is required.');
    expect(parsed.frontmatter.allowedTools).toEqual(['filesystem.read', 'filesystem.patch']);
    expect(parsed.frontmatter.references).toEqual(['src/main/agent/AgentRuntime.ts']);
    expect(parsed.body).toContain('# Code Edit');
  });

  it('accepts inline JSON-style list notation for allowed-tools', () => {
    const raw = [
      '---',
      'name: inline-list',
      'description: inline list test',
      'allowed-tools: [filesystem.read, "filesystem.patch"]',
      '---',
      '# Inline',
    ].join('\n');

    const parsed = parseSkillFile(raw);
    expect(parsed.frontmatter.allowedTools).toEqual(['filesystem.read', 'filesystem.patch']);
  });

  it('returns empty frontmatter and raw body when no frontmatter fence is present', () => {
    const raw = '# Plain\n\nJust a body, no frontmatter.';
    const parsed = parseSkillFile(raw);
    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe(raw);
  });

  it('normalizes kebab-case and snake_case keys to the canonical camelCase shape', () => {
    const raw = [
      '---',
      'allowed_tools:',
      '  - filesystem.read',
      '---',
      '# body',
    ].join('\n');

    const parsed = parseSkillFile(raw);
    expect(parsed.frontmatter.allowedTools).toEqual(['filesystem.read']);
  });
});

describe('agentSkillLoader', () => {
  it('loads every skill in the skills/ directory with the new frontmatter-backed fields', () => {
    const names = agentSkillLoader.listSkillNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('code-edit');
    expect(names).toContain('browser-operation');
    for (const name of names) {
      const skill = agentSkillLoader.loadSkill(name);
      expect(skill.name).toBe(name);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(Array.isArray(skill.allowedTools)).toBe(true);
      expect(Array.isArray(skill.references)).toBe(true);
      expect(skill.body).not.toContain('---\n');
    }
  });

  it('lists the full set of skills as AgentSkill records for the skill index', () => {
    const skills = agentSkillLoader.listSkills();
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.description).toBeTruthy();
    }
  });
});
