import { AgentRuntimeConfig, AgentSkill, AgentToolDefinition } from './AgentTypes';
export declare class AgentPromptBuilder {
    /**
     * Lazy-load variant: builds minimal prompt without skills.
     * Skills are compiled on demand in subsequent turns via buildSkillsForNames().
     */
    buildSystemPrompt(input: {
        config: AgentRuntimeConfig;
        skills: AgentSkill[];
        tools: AgentToolDefinition[];
    }): string;
    /**
     * Builds skill text for requested skill names.
     * Use this to lazily append skills to context in later turns.
     */
    buildSkillsForNames(skillNames: string[], allSkills: AgentSkill[]): string;
}
export declare const agentPromptBuilder: AgentPromptBuilder;
export declare function buildResponseStyleAddendum(task: string): string;
