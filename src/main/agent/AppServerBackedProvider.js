"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppServerBackedProvider = void 0;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const AppServerProcess_1 = require("./AppServerProcess");
const AppServerProvider_1 = require("./AppServerProvider");
const V2ToolBridge_1 = require("./V2ToolBridge");
class AppServerBackedProvider {
    options;
    supportsAppToolExecutor = true;
    delegate = null;
    connectPromise = null;
    pendingAbort = false;
    ownedBridge = null;
    ownedProcess = null;
    ownedContextPath = null;
    constructor(options) {
        this.options = options;
    }
    async prewarm() {
        await this.getDelegate();
    }
    async invoke(request) {
        const provider = await this.getDelegate();
        return provider.invoke(request);
    }
    abort() {
        this.pendingAbort = true;
        this.delegate?.abort();
    }
    async dispose() {
        this.pendingAbort = true;
        this.delegate?.abort();
        this.ownedProcess?.stop();
        if (this.ownedBridge) {
            await this.ownedBridge.stop();
        }
        if (this.ownedContextPath) {
            try {
                fs_1.default.unlinkSync(this.ownedContextPath);
            }
            catch {
                // Best-effort cleanup.
            }
        }
        this.ownedBridge = null;
        this.ownedProcess = null;
        this.ownedContextPath = null;
        this.delegate = null;
        this.connectPromise = null;
    }
    async getDelegate() {
        if (this.delegate)
            return this.delegate;
        if (!this.connectPromise) {
            this.connectPromise = (async () => {
                const session = this.options.process && this.options.wsPort !== undefined
                    ? { process: this.options.process, wsPort: this.options.wsPort }
                    : await this.startOwnedSession();
                const provider = new AppServerProvider_1.AppServerProvider({
                    providerId: this.options.providerId,
                    modelId: this.options.modelId,
                    process: session.process,
                    contextPath: this.ownedContextPath ?? undefined,
                });
                await provider.connect(session.wsPort);
                this.delegate = provider;
                if (this.pendingAbort) {
                    provider.abort();
                }
                return provider;
            })();
            this.connectPromise.catch(() => {
                this.connectPromise = null;
            });
        }
        return this.connectPromise;
    }
    async startOwnedSession() {
        const contextPath = path_1.default.join(os_1.default.tmpdir(), `v2-tool-context-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
        const bridge = new V2ToolBridge_1.V2ToolBridge(contextPath);
        await bridge.start();
        try {
            const shimPath = path_1.default.join(__dirname, 'v2-mcp-shim.js');
            const process = new AppServerProcess_1.AppServerProcess(bridge.getPort(), shimPath, contextPath);
            await process.start();
            const { wsPort } = await process.waitUntilReady();
            this.ownedBridge = bridge;
            this.ownedProcess = process;
            this.ownedContextPath = contextPath;
            return { process, wsPort };
        }
        catch (error) {
            await bridge.stop().catch(() => undefined);
            try {
                fs_1.default.unlinkSync(contextPath);
            }
            catch {
                // Best-effort cleanup.
            }
            throw error;
        }
    }
}
exports.AppServerBackedProvider = AppServerBackedProvider;
//# sourceMappingURL=AppServerBackedProvider.js.map