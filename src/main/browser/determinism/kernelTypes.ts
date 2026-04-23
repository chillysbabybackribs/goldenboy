export type ClockSpec = 'frozen' | number;

export interface DeterminismConfig {
  seed?: number;
  clock?: ClockSpec;
  viewport?: { width: number; height: number; deviceScaleFactor?: number };
  locale?: string;
  timezone?: string;
  userAgent?: string;
  disableAnimations?: boolean;
  reduceMotion?: boolean;
  blockNetworkPatterns?: string[];
}

export interface ResolvedDeterminismConfig {
  seed: number;
  clock: ClockSpec;
  viewport: { width: number; height: number; deviceScaleFactor: number };
  locale: string;
  timezone: string;
  userAgent: string | null;
  disableAnimations: boolean;
  reduceMotion: boolean;
  blockNetworkPatterns: string[];
}

export interface PinHandle {
  name: string;
  revert: () => Promise<void> | void;
}

export interface DeterministicTabState {
  tabId: string;
  config: ResolvedDeterminismConfig;
  enteredAt: number;
  pinHandles: PinHandle[];
}

export interface KernelResult {
  tabId: string;
  pinsApplied: string[];
  enteredAt: number;
}

export interface KernelExitReport {
  tabId: string;
  pinsReverted: string[];
  errors: Array<{ pin: string; message: string }>;
}

export class KernelError extends Error {
  readonly pin: string;
  readonly applied: string[];
  readonly reverted: string[];

  constructor(message: string, pin: string, applied: string[], reverted: string[]) {
    super(message);
    this.name = 'KernelError';
    this.pin = pin;
    this.applied = applied;
    this.reverted = reverted;
  }
}

export const DEFAULT_CONFIG: ResolvedDeterminismConfig = {
  seed: 1,
  clock: 'frozen',
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  locale: 'en-US',
  timezone: 'UTC',
  userAgent: null,
  disableAnimations: true,
  reduceMotion: true,
  blockNetworkPatterns: [],
};

export function resolveConfig(input: DeterminismConfig | undefined): ResolvedDeterminismConfig {
  const src = input ?? {};
  return {
    seed: src.seed ?? DEFAULT_CONFIG.seed,
    clock: src.clock ?? DEFAULT_CONFIG.clock,
    viewport: {
      width: src.viewport?.width ?? DEFAULT_CONFIG.viewport.width,
      height: src.viewport?.height ?? DEFAULT_CONFIG.viewport.height,
      deviceScaleFactor: src.viewport?.deviceScaleFactor ?? DEFAULT_CONFIG.viewport.deviceScaleFactor,
    },
    locale: src.locale ?? DEFAULT_CONFIG.locale,
    timezone: src.timezone ?? DEFAULT_CONFIG.timezone,
    userAgent: src.userAgent ?? DEFAULT_CONFIG.userAgent,
    disableAnimations: src.disableAnimations ?? DEFAULT_CONFIG.disableAnimations,
    reduceMotion: src.reduceMotion ?? DEFAULT_CONFIG.reduceMotion,
    blockNetworkPatterns: src.blockNetworkPatterns ?? DEFAULT_CONFIG.blockNetworkPatterns,
  };
}
