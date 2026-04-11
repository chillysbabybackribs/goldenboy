// ═══════════════════════════════════════════════════════════════════════════
// Renderer Global Types — references canonical definitions from shared/types/
// so the renderer scripts can use them as ambient globals without imports.
//
// Using import() type expressions keeps this file as an ambient script
// (no top-level import/export) so all declarations remain globally visible.
// ═══════════════════════════════════════════════════════════════════════════

// ─── Surface Actions ─────────────────────────────────────────────────────
type SurfaceActionRecord = import('../shared/actions/surfaceActionTypes').SurfaceActionRecord;

// ─── Terminal ────────────────────────────────────────────────────────────
type TerminalSessionInfo = import('../shared/types/terminal').TerminalSessionInfo;

// ─── Browser Runtime ─────────────────────────────────────────────────────
type BrowserNavigationState = import('../shared/types/browser').BrowserNavigationState;
type BrowserHistoryEntry = import('../shared/types/browser').BrowserHistoryEntry;
type BookmarkEntry = import('../shared/types/browser').BookmarkEntry;
type BrowserDownloadState = import('../shared/types/browser').BrowserDownloadState;
type BrowserPermissionRequest = import('../shared/types/browser').BrowserPermissionRequest;
type ExtensionInfo = import('../shared/types/browser').ExtensionInfo;
type FindInPageState = import('../shared/types/browser').FindInPageState;
type BrowserSettings = import('../shared/types/browser').BrowserSettings;
type BrowserAuthDiagnostics = import('../shared/types/browser').BrowserAuthDiagnostics;
type TabInfo = import('../shared/types/browser').TabInfo;
type BrowserState = import('../shared/types/browser').BrowserState;

// ─── Browser Intelligence ────────────────────────────────────────────────
type BrowserActionableElement = import('../shared/types/browserIntelligence').BrowserActionableElement;
type BrowserFormFieldModel = import('../shared/types/browserIntelligence').BrowserFormFieldModel;
type BrowserFormModel = import('../shared/types/browserIntelligence').BrowserFormModel;
type BrowserSnapshot = import('../shared/types/browserIntelligence').BrowserSnapshot;
type BrowserConsoleEvent = import('../shared/types/browserIntelligence').BrowserConsoleEvent;
type BrowserNetworkEvent = import('../shared/types/browserIntelligence').BrowserNetworkEvent;
type BrowserFinding = import('../shared/types/browserIntelligence').BrowserFinding;
type BrowserTaskMemory = import('../shared/types/browserIntelligence').BrowserTaskMemory;

// ─── Model ───────────────────────────────────────────────────────────────
type TaskMemoryEntry = import('../shared/types/model').TaskMemoryEntry;
type TaskMemoryRecord = import('../shared/types/model').TaskMemoryRecord;

// ─── Workspace API (canonical from ipc.ts) ───────────────────────────────
type WorkspaceAPI = import('../shared/types/ipc').WorkspaceAPI;

// ─── Window augmentation ─────────────────────────────────────────────────
interface Window { workspaceAPI: WorkspaceAPI; }
declare const workspaceAPI: WorkspaceAPI;
