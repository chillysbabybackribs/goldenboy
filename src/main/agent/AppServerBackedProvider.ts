import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ProviderId } from '../../shared/types/model';
import type { AgentProvider, AgentProviderRequest, AgentProviderResult } from './AgentTypes';
import type { AppServerProcess } from './AppServerProcess';
import { AppServerProcess as ManagedAppServerProcess } from './AppServerProcess';
import { AppServerProvider } from './AppServerProvider';
import { V2ToolBridge } from './V2ToolBridge';

type AppServerBackedProviderOptions = {
  providerId: ProviderId;
  modelId: string;
  process?: AppServerProcess;
  wsPort?: number;
};

export class AppServerBackedProvider implements AgentProvider {
  readonly supportsAppToolExecutor = true;

  private delegate: AppServerProvider | null = null;
  private connectPromise: Promise<AppServerProvider> | null = null;
  private pendingAbort = false;
  private ownedBridge: V2ToolBridge | null = null;
  private ownedProcess: ManagedAppServerProcess | null = null;
  private ownedContextPath: string | null = null;

  constructor(private readonly options: AppServerBackedProviderOptions) {}

  async invoke(request: AgentProviderRequest): Promise<AgentProviderResult> {
    const provider = await this.getDelegate();
    return provider.invoke(request);
  }

  abort(): void {
    this.pendingAbort = true;
    this.delegate?.abort();
  }

  async dispose(): Promise<void> {
    this.pendingAbort = true;
    this.delegate?.abort();
    this.ownedProcess?.stop();
    if (this.ownedBridge) {
      await this.ownedBridge.stop();
    }
    if (this.ownedContextPath) {
      try {
        fs.unlinkSync(this.ownedContextPath);
      } catch {
        // Best-effort cleanup.
      }
    }
    this.ownedBridge = null;
    this.ownedProcess = null;
    this.ownedContextPath = null;
    this.delegate = null;
    this.connectPromise = null;
  }

  private async getDelegate(): Promise<AppServerProvider> {
    if (this.delegate) return this.delegate;
    if (!this.connectPromise) {
      this.connectPromise = (async () => {
        const session = this.options.process && this.options.wsPort !== undefined
          ? { process: this.options.process, wsPort: this.options.wsPort }
          : await this.startOwnedSession();
        const provider = new AppServerProvider({
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
    }

    return this.connectPromise;
  }

  private async startOwnedSession(): Promise<{ process: ManagedAppServerProcess; wsPort: number }> {
    const contextPath = path.join(
      os.tmpdir(),
      `v2-tool-context-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
    );
    const bridge = new V2ToolBridge(contextPath);
    await bridge.start();

    try {
      const shimPath = path.join(__dirname, 'v2-mcp-shim.js');
      const process = new ManagedAppServerProcess(bridge.getPort(), shimPath, contextPath);
      await process.start();
      const { wsPort } = await process.waitUntilReady();
      this.ownedBridge = bridge;
      this.ownedProcess = process;
      this.ownedContextPath = contextPath;
      return { process, wsPort };
    } catch (error) {
      await bridge.stop().catch(() => undefined);
      try {
        fs.unlinkSync(contextPath);
      } catch {
        // Best-effort cleanup.
      }
      throw error;
    }
  }
}
