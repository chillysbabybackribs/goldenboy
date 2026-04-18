import { EventEmitter } from 'events';
export declare function parseListeningPort(line: string): number | null;
export declare function mergeTomlMcpEntry(existing: string, shimPath: string, bridgePort: number, contextPath: string): string;
export declare class AppServerProcess extends EventEmitter {
    private readonly bridgePort;
    private readonly shimPath;
    private readonly contextPath;
    private state;
    private child;
    private wsPort;
    private backoffMs;
    private stopped;
    private readyPromise;
    private readyResolve;
    private readyReject;
    private cleanupHandlersInstalled;
    private readonly processExitHandler;
    constructor(bridgePort: number, shimPath: string, contextPath: string);
    isReady(): boolean;
    waitUntilReady(): Promise<{
        wsPort: number;
    }>;
    start(): Promise<void>;
    stop(): void;
    private clearConfig;
    private writeConfig;
    private spawnAndWait;
    private spawnProcess;
    private pollReadyz;
    private handleCrash;
    private killChildProcessTree;
    private installCleanupHandlers;
    private removeCleanupHandlers;
}
