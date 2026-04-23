export interface CdpHandle {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  detach: () => Promise<void>;
}

export interface KernelCapabilities {
  attachCdp(tabId: string): Promise<CdpHandle>;

  setUserAgent(tabId: string, userAgent: string): Promise<string>;
  restoreUserAgent(tabId: string, previous: string): Promise<void>;

  insertCss(tabId: string, css: string): Promise<string>;
  removeInsertedCss(tabId: string, cssKey: string): Promise<void>;

  setViewport(tabId: string, viewport: { width: number; height: number; deviceScaleFactor: number }): Promise<void>;
  clearViewport(tabId: string): Promise<void>;

  registerRequestBlocker(tabId: string, patterns: string[]): Promise<{ dispose: () => void }>;

  isTabAlive(tabId: string): boolean;
}
