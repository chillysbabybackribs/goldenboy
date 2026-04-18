import { AgentProvider } from '../AgentTypes';
import { SubAgentRecord, SubAgentResult, SubAgentSpawnInput } from './SubAgentTypes';
export declare class SubAgentManager {
    private readonly providerFactory;
    private records;
    private results;
    private runPromises;
    constructor(providerFactory: (input: SubAgentSpawnInput) => AgentProvider);
    spawn(parentRunId: string, input: SubAgentSpawnInput): SubAgentRecord;
    run(parentRunId: string, input: SubAgentSpawnInput): Promise<SubAgentResult>;
    spawnBackground(parentRunId: string, input: SubAgentSpawnInput): SubAgentRecord;
    wait(id: string, timeoutMs?: number): Promise<SubAgentResult>;
    cancel(id: string): SubAgentRecord;
    get(id: string): SubAgentRecord | null;
    list(parentRunId?: string): SubAgentRecord[];
    private skillNamesForRole;
    private contextForSpawn;
    private prune;
    private deleteRecord;
}
