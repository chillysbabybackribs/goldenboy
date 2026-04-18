import { AgentSkill } from './AgentTypes';
export declare class AgentSkillLoader {
    private skillCache;
    listSkillNames(): string[];
    loadSkill(name: string): AgentSkill;
    loadSkills(names: string[]): AgentSkill[];
}
export declare const agentSkillLoader: AgentSkillLoader;
