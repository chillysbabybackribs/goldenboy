import type { WebContentsView } from 'electron';
import {
  BrowserJavaScriptDialog,
  BrowserJavaScriptDialogType,
  TabInfo,
} from '../../shared/types/browser';
import { generateId } from '../../shared/utils/ids';

type TabEntry = {
  id: string;
  view: WebContentsView;
  info: TabInfo;
};

type PromptDialogResolution = {
  dialogId: string;
  resolved: boolean;
  value: string | null;
};

type Deps = {
  resolveEntry: (tabId?: string) => TabEntry | undefined;
  resolveTabIdByWebContentsId: (webContentsId: number) => string | null;
  emitLog: (level: 'info' | 'warn' | 'error', message: string) => void;
  syncState: () => void;
};

const MAIN_WORLD_PROMPT_SHIM_SCRIPT = String.raw`
(() => {
  const pageWindow = window;
  if (pageWindow.__browserPromptShimInstalled) return true;
  const bridge = pageWindow.browserPromptShim;
  if (!bridge || typeof bridge.openSync !== 'function') return false;

  const nativePrompt = typeof pageWindow.prompt === 'function'
    ? pageWindow.prompt.bind(pageWindow)
    : null;

  pageWindow.prompt = function browserPromptShim(message, defaultValue) {
    const text = typeof message === 'string' ? message : '';
    const defaultPrompt = typeof defaultValue === 'string' ? defaultValue : '';

    if (nativePrompt) {
      try {
        return nativePrompt(text, defaultPrompt);
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        if (!/prompt\(\)\s+is\s+not\s+supported/i.test(errorText)) {
          throw err;
        }
      }
    }

    return bridge.openSync(text, defaultPrompt, pageWindow.location?.href || '');
  };

  pageWindow.__browserPromptShimInstalled = true;
  return true;
})()
`;

export class BrowserDialogManager {
  private pendingDialogs = new Map<string, BrowserJavaScriptDialog>();
  private promptDialogResolutions = new Map<string, PromptDialogResolution>();
  private dialogDebuggerTabs = new Set<string>();
  private deps: Deps;

  constructor(deps: Deps) {
    this.deps = deps;
  }

  async installPromptShimInPage(entry: TabEntry): Promise<void> {
    const wc = entry.view.webContents;
    if (wc.isDestroyed()) return;
    try {
      await wc.executeJavaScript(MAIN_WORLD_PROMPT_SHIM_SCRIPT, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.emitLog('warn', `Prompt shim injection failed: ${message}`);
    }
  }

  ensureDebugger(entry: TabEntry): void {
    if (this.dialogDebuggerTabs.has(entry.id)) return;
    const wc = entry.view.webContents;
    const dbg = wc.debugger;
    try {
      if (!dbg.isAttached()) {
        dbg.attach('1.3');
      }
      void dbg.sendCommand('Page.enable').catch(() => {});
    } catch (err) {
      this.deps.emitLog('warn', `Browser dialog debugger unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    this.dialogDebuggerTabs.add(entry.id);

    dbg.on('detach', () => {
      this.dialogDebuggerTabs.delete(entry.id);
      this.clearPendingDialogsForTab(entry.id);
    });

    dbg.on('message', (_event, method: string, params: any) => {
      if (method === 'Page.javascriptDialogClosed') {
        this.clearPendingDialogsForTab(entry.id);
        return;
      }
      if (method !== 'Page.javascriptDialogOpening') return;

      const type = this.normalizeJavaScriptDialogType(params?.type);
      const dialog: BrowserJavaScriptDialog = {
        id: generateId('dialog'),
        tabId: entry.id,
        url: typeof params?.url === 'string' ? params.url : entry.info.navigation.url,
        type,
        backend: 'cdp',
        message: typeof params?.message === 'string' ? params.message : '',
        defaultPrompt: typeof params?.defaultPrompt === 'string' ? params.defaultPrompt : '',
        openedAt: Date.now(),
      };
      this.pendingDialogs.set(dialog.id, dialog);
      this.deps.emitLog('info', `JavaScript ${dialog.type} dialog opened: ${dialog.message || '(empty)'}`);
      this.deps.syncState();
    });
  }

  detachTab(tabId: string): void {
    this.dialogDebuggerTabs.delete(tabId);
    this.clearPendingDialogsForTab(tabId);
  }

  clearPendingDialogsForTab(tabId: string): void {
    let changed = false;
    for (const [id, dialog] of this.pendingDialogs.entries()) {
      if (dialog.tabId !== tabId) continue;
      this.pendingDialogs.delete(id);
      const resolution = this.promptDialogResolutions.get(id);
      if (resolution && !resolution.resolved) {
        resolution.resolved = true;
        resolution.value = null;
      }
      changed = true;
    }
    if (changed) this.deps.syncState();
  }

  getPendingDialogs(tabId?: string): BrowserJavaScriptDialog[] {
    const dialogs = Array.from(this.pendingDialogs.values());
    return tabId ? dialogs.filter(dialog => dialog.tabId === tabId) : dialogs;
  }

  openPromptDialogFallback(input: {
    webContentsId: number;
    message: string;
    defaultPrompt?: string;
    url?: string;
  }): { dialogId: string; created: boolean } {
    const tabId = this.deps.resolveTabIdByWebContentsId(input.webContentsId);
    if (!tabId) {
      return { dialogId: '', created: false };
    }

    const existing = this.getPendingDialogs(tabId).find(dialog => dialog.type === 'prompt' && dialog.backend === 'shim');
    if (existing) {
      return { dialogId: existing.id, created: false };
    }

    const entry = this.deps.resolveEntry(tabId);
    const dialog: BrowserJavaScriptDialog = {
      id: generateId('dialog'),
      tabId,
      url: input.url || entry?.info.navigation.url || '',
      type: 'prompt',
      backend: 'shim',
      message: input.message || '',
      defaultPrompt: input.defaultPrompt || '',
      openedAt: Date.now(),
    };
    this.pendingDialogs.set(dialog.id, dialog);
    this.promptDialogResolutions.set(dialog.id, {
      dialogId: dialog.id,
      resolved: false,
      value: null,
    });
    this.deps.emitLog('info', `JavaScript prompt dialog opened via shim: ${dialog.message || '(empty)'}`);
    this.deps.syncState();
    return { dialogId: dialog.id, created: true };
  }

  pollPromptDialogFallback(dialogId: string): { done: boolean; value: string | null } {
    const resolution = this.promptDialogResolutions.get(dialogId);
    if (!resolution) {
      return { done: true, value: null };
    }
    if (resolution.resolved) {
      this.promptDialogResolutions.delete(dialogId);
      return { done: true, value: resolution.value };
    }
    return { done: false, value: null };
  }

  async acceptDialog(
    input: {
      tabId?: string;
      dialogId?: string;
      promptText?: string;
    } = {},
    activeTabId?: string,
  ): Promise<{ accepted: boolean; error: string | null; dialog: BrowserJavaScriptDialog | null }> {
    return this.resolveJavaScriptDialog({ ...input, accept: true }, activeTabId);
  }

  async dismissDialog(
    input: {
      tabId?: string;
      dialogId?: string;
    } = {},
    activeTabId?: string,
  ): Promise<{ dismissed: boolean; error: string | null; dialog: BrowserJavaScriptDialog | null }> {
    const result = await this.resolveJavaScriptDialog({ ...input, accept: false }, activeTabId);
    return { dismissed: result.accepted, error: result.error, dialog: result.dialog };
  }

  dispose(): void {
    this.pendingDialogs.clear();
    this.promptDialogResolutions.clear();
    this.dialogDebuggerTabs.clear();
  }

  private normalizeJavaScriptDialogType(value: unknown): BrowserJavaScriptDialogType {
    switch (value) {
      case 'alert':
      case 'confirm':
      case 'prompt':
      case 'beforeunload':
        return value;
      default:
        return 'unknown';
    }
  }

  private async resolveJavaScriptDialog(
    input: {
      accept: boolean;
      tabId?: string;
      dialogId?: string;
      promptText?: string;
    },
    activeTabId?: string,
  ): Promise<{ accepted: boolean; error: string | null; dialog: BrowserJavaScriptDialog | null }> {
    const dialog = input.dialogId
      ? this.pendingDialogs.get(input.dialogId) || null
      : this.getPendingDialogs(input.tabId || activeTabId)[0] || null;
    const entry = this.deps.resolveEntry(dialog?.tabId || input.tabId || activeTabId);
    if (!entry) {
      return { accepted: false, error: 'No active tab', dialog };
    }

    try {
      if (dialog?.backend === 'shim' && dialog.type === 'prompt') {
        const resolution = this.promptDialogResolutions.get(dialog.id);
        if (!resolution) {
          return { accepted: false, error: 'Prompt dialog resolution missing', dialog };
        }
        resolution.resolved = true;
        resolution.value = input.accept ? (input.promptText ?? dialog.defaultPrompt ?? '') : null;
        this.pendingDialogs.delete(dialog.id);
        this.deps.syncState();
        return { accepted: true, error: null, dialog };
      }

      this.ensureDebugger(entry);
      await entry.view.webContents.debugger.sendCommand('Page.handleJavaScriptDialog', {
        accept: input.accept,
        promptText: input.promptText || '',
      });
      if (dialog) this.pendingDialogs.delete(dialog.id);
      else this.clearPendingDialogsForTab(entry.id);
      this.deps.syncState();
      return { accepted: true, error: null, dialog };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { accepted: false, error: message, dialog };
    }
  }
}
