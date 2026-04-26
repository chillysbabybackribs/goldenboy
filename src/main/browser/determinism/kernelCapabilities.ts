export type CdpEventHandler = (params: Record<string, unknown>) => void | Promise<void>;

export interface CdpHandle {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  on: (event: string, handler: CdpEventHandler) => void;
  off: (event: string, handler: CdpEventHandler) => void;
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

  isTabAlive(tabId: string): boolean;
}
