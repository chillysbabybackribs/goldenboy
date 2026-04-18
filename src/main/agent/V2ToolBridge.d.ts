export declare class V2ToolBridge {
    private readonly contextPath;
    private server;
    private port;
    constructor(contextPath: string);
    getPort(): number;
    start(): Promise<void>;
    stop(): Promise<void>;
    private handleRequest;
}
