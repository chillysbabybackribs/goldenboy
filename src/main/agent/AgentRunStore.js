"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRunStore = exports.AgentRunStore = void 0;
const MAX_RUN_RECORDS = 250;
const MAX_TOOL_CALL_RECORDS = 1000;
const COMPLETED_RECORD_TTL_MS = 6 * 60 * 60 * 1000;
function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
class AgentRunStore {
    runs = new Map();
    toolCalls = new Map();
    createRun(input) {
        const run = {
            ...input,
            id: makeId('run'),
            status: 'queued',
            startedAt: Date.now(),
            completedAt: null,
            resultSummary: null,
            error: null,
        };
        this.runs.set(run.id, run);
        this.prune();
        return { ...run };
    }
    updateRun(id, patch) {
        const current = this.runs.get(id);
        if (!current)
            throw new Error(`Agent run not found: ${id}`);
        const next = { ...current, ...patch };
        this.runs.set(id, next);
        return { ...next };
    }
    finishRun(id, status, resultSummary, error = null) {
        return this.updateRun(id, {
            status,
            resultSummary,
            error,
            completedAt: Date.now(),
        });
    }
    getRun(id) {
        const run = this.runs.get(id);
        return run ? { ...run } : null;
    }
    listRuns() {
        return Array.from(this.runs.values()).map(run => ({ ...run }));
    }
    startToolCall(input) {
        const record = {
            id: makeId('tool'),
            runId: input.runId,
            agentId: input.agentId,
            toolName: input.toolName,
            input: input.toolInput,
            output: null,
            status: 'running',
            startedAt: Date.now(),
            completedAt: null,
            error: null,
        };
        this.toolCalls.set(record.id, record);
        this.prune();
        return { ...record };
    }
    finishToolCall(id, status, output, error = null) {
        const current = this.toolCalls.get(id);
        if (!current)
            throw new Error(`Agent tool call not found: ${id}`);
        const next = {
            ...current,
            status,
            output,
            error,
            completedAt: Date.now(),
        };
        this.toolCalls.set(id, next);
        return { ...next };
    }
    listToolCalls(runId) {
        const calls = Array.from(this.toolCalls.values());
        return calls
            .filter(call => !runId || call.runId === runId)
            .map(call => ({ ...call }));
    }
    prune(now = Date.now()) {
        const removableRuns = Array.from(this.runs.values())
            .filter(run => run.status !== 'queued' && run.status !== 'running')
            .filter(run => (run.completedAt ?? run.startedAt) <= now - COMPLETED_RECORD_TTL_MS)
            .sort((a, b) => (a.completedAt ?? a.startedAt) - (b.completedAt ?? b.startedAt));
        for (const run of removableRuns) {
            this.runs.delete(run.id);
            for (const call of Array.from(this.toolCalls.values())) {
                if (call.runId === run.id)
                    this.toolCalls.delete(call.id);
            }
        }
        this.pruneMapByAge(this.runs, MAX_RUN_RECORDS, run => run.status !== 'queued' && run.status !== 'running', run => run.completedAt ?? run.startedAt);
        this.pruneMapByAge(this.toolCalls, MAX_TOOL_CALL_RECORDS, call => call.status !== 'running', call => call.completedAt ?? call.startedAt);
    }
    pruneMapByAge(map, maxSize, canRemove, timestamp) {
        if (map.size <= maxSize)
            return;
        const candidates = Array.from(map.values())
            .filter(canRemove)
            .sort((a, b) => timestamp(a) - timestamp(b));
        for (const candidate of candidates) {
            if (map.size <= maxSize)
                break;
            map.delete(candidate.id);
        }
    }
}
exports.AgentRunStore = AgentRunStore;
exports.agentRunStore = new AgentRunStore();
//# sourceMappingURL=AgentRunStore.js.map