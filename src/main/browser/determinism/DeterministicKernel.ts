import type { KernelCapabilities } from './kernelCapabilities';
import {
  DeterminismConfig,
  DeterministicTabState,
  KernelError,
  KernelExitReport,
  KernelResult,
  PinHandle,
  ResolvedDeterminismConfig,
  resolveConfig,
} from './kernelTypes';

export interface PinContext {
  tabId: string;
  config: ResolvedDeterminismConfig;
  capabilities: KernelCapabilities;
}

export interface Pin {
  name: string;
  apply: (ctx: PinContext) => Promise<PinHandle>;
}

export interface DeterministicKernelOptions {
  capabilities: KernelCapabilities;
  pins: readonly Pin[];
  now?: () => number;
}

export class DeterministicKernel {
  private readonly capabilities: KernelCapabilities;
  private readonly pins: readonly Pin[];
  private readonly now: () => number;
  private readonly registry = new Map<string, DeterministicTabState>();

  constructor(opts: DeterministicKernelOptions) {
    this.capabilities = opts.capabilities;
    this.pins = opts.pins;
    this.now = opts.now ?? (() => Date.now());
  }

  isDeterministic(tabId: string): boolean {
    return this.registry.has(tabId);
  }

  getState(tabId: string): DeterministicTabState | null {
    return this.registry.get(tabId) ?? null;
  }

  async enter(tabId: string, input: DeterminismConfig | undefined): Promise<KernelResult> {
    const resolved = resolveConfig(input);
    const existing = this.registry.get(tabId);
    if (existing && configsEqual(existing.config, resolved)) {
      return {
        tabId,
        pinsApplied: existing.pinHandles.map(h => h.name),
        enteredAt: existing.enteredAt,
      };
    }
    if (existing) {
      await this.exit(tabId);
    }

    const ctx: PinContext = { tabId, config: resolved, capabilities: this.capabilities };
    const applied: PinHandle[] = [];
    for (const pin of this.pins) {
      try {
        const handle = await pin.apply(ctx);
        applied.push(handle);
      } catch (err) {
        const reverted: string[] = [];
        for (let i = applied.length - 1; i >= 0; i--) {
          try {
            await applied[i].revert();
            reverted.push(applied[i].name);
          } catch {
            // Swallow revert errors during rollback; the original failure is the signal.
          }
        }
        const message = err instanceof Error ? err.message : String(err);
        throw new KernelError(
          `pin "${pin.name}" failed: ${message}`,
          pin.name,
          applied.map(h => h.name),
          reverted,
        );
      }
    }

    const enteredAt = this.now();
    this.registry.set(tabId, { tabId, config: resolved, enteredAt, pinHandles: applied });
    return { tabId, pinsApplied: applied.map(h => h.name), enteredAt };
  }

  async exit(tabId: string): Promise<KernelExitReport> {
    const state = this.registry.get(tabId);
    if (!state) return { tabId, pinsReverted: [], errors: [] };

    const pinsReverted: string[] = [];
    const errors: KernelExitReport['errors'] = [];
    for (let i = state.pinHandles.length - 1; i >= 0; i--) {
      const handle = state.pinHandles[i];
      try {
        await handle.revert();
        pinsReverted.push(handle.name);
      } catch (err) {
        errors.push({ pin: handle.name, message: err instanceof Error ? err.message : String(err) });
      }
    }
    this.registry.delete(tabId);
    return { tabId, pinsReverted, errors };
  }

  purgeTab(tabId: string): void {
    this.registry.delete(tabId);
  }
}

function configsEqual(a: ResolvedDeterminismConfig, b: ResolvedDeterminismConfig): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
