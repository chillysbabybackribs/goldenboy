import { AppState, ExecutionLayoutPreset, LogLevel, LogSource, TaskStatus } from './appState';
import { AppEventType } from './events';
import { PhysicalWindowRole } from './windowRoles';
import { TerminalSessionInfo } from './terminal';
import { BrowserState, BrowserHistoryEntry, BrowserNavigationState, TabInfo, BookmarkEntry, ExtensionInfo, BrowserSettings, BrowserDownloadState, BrowserAuthDiagnostics } from './browser';
import { BrowserReplayRequest, BrowserTargetValidationResult } from './browserDeterministic';
import { BrowserOperationLedgerEntry } from './browserOperationLedger';
import { BrowserActionableElement, BrowserConsoleEvent, BrowserFinding, BrowserFormModel, BrowserNetworkEvent, BrowserSiteStrategy, BrowserSnapshot, BrowserSurfaceEvalFixture, BrowserTaskMemory } from './browserIntelligence';
import { SurfaceActionInput, SurfaceActionRecord } from '../actions/surfaceActionTypes';
import { AgentInvocationOptions, TaskMemoryRecord } from './model';
import { DocumentImportRequest, DocumentInvocationAttachment } from './attachments';
import { ArtifactRecord, CreateArtifactInput } from './artifacts';
import { DocumentArtifactSummary, DocumentArtifactView } from './document';
export declare const IPC_CHANNELS: {
    readonly GET_STATE: "workspace:get-state";
    readonly GET_ROLE: "workspace:get-role";
    readonly EMIT_EVENT: "workspace:emit-event";
    readonly STATE_UPDATE: "workspace:state-update";
    readonly EVENT_BROADCAST: "workspace:event-broadcast";
    readonly CREATE_TASK: "workspace:create-task";
    readonly DELETE_TASK: "workspace:delete-task";
    readonly UPDATE_TASK_STATUS: "workspace:update-task-status";
    readonly SET_ACTIVE_TASK: "workspace:set-active-task";
    readonly RESET_TOKEN_USAGE: "workspace:reset-token-usage";
    readonly ADD_LOG: "workspace:add-log";
    readonly ATTACHMENTS_IMPORT_DOCUMENTS: "attachments:import-documents";
    readonly ARTIFACT_CREATE: "artifact:create";
    readonly ARTIFACT_GET: "artifact:get";
    readonly ARTIFACT_LIST: "artifact:list";
    readonly ARTIFACT_SET_ACTIVE: "artifact:set-active";
    readonly ARTIFACT_GET_ACTIVE: "artifact:get-active";
    readonly ARTIFACT_DELETE: "artifact:delete";
    readonly ARTIFACT_REPLACE_CONTENT: "artifact:replace-content";
    readonly ARTIFACT_APPEND_CONTENT: "artifact:append-content";
    readonly DOCUMENT_OPEN_ARTIFACT: "document:open-artifact";
    readonly DOCUMENT_GET_CURRENT: "document:get-current";
    readonly DOCUMENT_GET_ARTIFACT: "document:get-artifact";
    readonly DOCUMENT_LIST_ARTIFACTS: "document:list-artifacts";
    readonly DOCUMENT_SET_CURRENT: "document:set-current";
    readonly APPLY_EXECUTION_PRESET: "workspace:apply-execution-preset";
    readonly SET_SPLIT_RATIO: "workspace:set-split-ratio";
    readonly SUBMIT_SURFACE_ACTION: "workspace:submit-surface-action";
    readonly CANCEL_QUEUED_ACTION: "workspace:cancel-queued-action";
    readonly GET_RECENT_ACTIONS: "workspace:get-recent-actions";
    readonly GET_ACTIONS_BY_TARGET: "workspace:get-actions-by-target";
    readonly GET_ACTIONS_BY_TASK: "workspace:get-actions-by-task";
    readonly GET_QUEUE_DIAGNOSTICS: "workspace:get-queue-diagnostics";
    readonly SURFACE_ACTION_UPDATE: "workspace:surface-action-update";
    readonly BROWSER_GET_STATE: "browser:get-state";
    readonly BROWSER_GET_HISTORY: "browser:get-history";
    readonly BROWSER_CLEAR_HISTORY: "browser:clear-history";
    readonly BROWSER_CLEAR_DATA: "browser:clear-data";
    readonly BROWSER_CLEAR_SITE_DATA: "browser:clear-site-data";
    readonly BROWSER_REPORT_BOUNDS: "browser:report-bounds";
    readonly BROWSER_GET_TABS: "browser:get-tabs";
    readonly BROWSER_CAPTURE_TAB_SNAPSHOT: "browser:capture-tab-snapshot";
    readonly BROWSER_GET_ACTIONABLE_ELEMENTS: "browser:get-actionable-elements";
    readonly BROWSER_GET_FORM_MODEL: "browser:get-form-model";
    readonly BROWSER_GET_CONSOLE_EVENTS: "browser:get-console-events";
    readonly BROWSER_GET_NETWORK_EVENTS: "browser:get-network-events";
    readonly BROWSER_GET_OPERATION_LEDGER: "browser:get-operation-ledger";
    readonly BROWSER_REPLAY_OPERATION: "browser:replay-operation";
    readonly BROWSER_RECORD_FINDING: "browser:record-finding";
    readonly BROWSER_GET_TASK_MEMORY: "browser:get-task-memory";
    readonly BROWSER_GET_SITE_STRATEGY: "browser:get-site-strategy";
    readonly BROWSER_SAVE_SITE_STRATEGY: "browser:save-site-strategy";
    readonly BROWSER_EXPORT_SURFACE_EVAL_FIXTURE: "browser:export-surface-eval-fixture";
    readonly BROWSER_ADD_BOOKMARK: "browser:add-bookmark";
    readonly BROWSER_REMOVE_BOOKMARK: "browser:remove-bookmark";
    readonly BROWSER_GET_BOOKMARKS: "browser:get-bookmarks";
    readonly BROWSER_ZOOM_IN: "browser:zoom-in";
    readonly BROWSER_ZOOM_OUT: "browser:zoom-out";
    readonly BROWSER_ZOOM_RESET: "browser:zoom-reset";
    readonly BROWSER_FIND_IN_PAGE: "browser:find-in-page";
    readonly BROWSER_FIND_NEXT: "browser:find-next";
    readonly BROWSER_FIND_PREVIOUS: "browser:find-previous";
    readonly BROWSER_STOP_FIND: "browser:stop-find";
    readonly BROWSER_TOGGLE_DEVTOOLS: "browser:toggle-devtools";
    readonly BROWSER_GET_SETTINGS: "browser:get-settings";
    readonly BROWSER_UPDATE_SETTINGS: "browser:update-settings";
    readonly BROWSER_GET_AUTH_DIAGNOSTICS: "browser:get-auth-diagnostics";
    readonly BROWSER_CLEAR_GOOGLE_AUTH_STATE: "browser:clear-google-auth-state";
    readonly BROWSER_LOAD_EXTENSION: "browser:load-extension";
    readonly BROWSER_REMOVE_EXTENSION: "browser:remove-extension";
    readonly BROWSER_GET_EXTENSIONS: "browser:get-extensions";
    readonly BROWSER_GET_DOWNLOADS: "browser:get-downloads";
    readonly BROWSER_CANCEL_DOWNLOAD: "browser:cancel-download";
    readonly BROWSER_CLEAR_DOWNLOADS: "browser:clear-downloads";
    readonly BROWSER_STATE_UPDATE: "browser:state-update";
    readonly BROWSER_NAV_UPDATE: "browser:nav-update";
    readonly BROWSER_FIND_UPDATE: "browser:find-update";
    readonly DEBUG_TEST_DISK_EXTRACT: "debug:test-disk-extract";
    readonly MODEL_INVOKE: "model:invoke";
    readonly MODEL_CANCEL: "model:cancel";
    readonly MODEL_GET_PROVIDERS: "model:get-providers";
    readonly MODEL_GET_TASK_MEMORY: "model:get-task-memory";
    readonly MODEL_RESOLVE: "model:resolve";
    readonly MODEL_RUN_INTENT_PROGRAM: "model:run-intent-program";
    readonly MODEL_PROGRESS: "model:progress";
    readonly TERMINAL_START_SESSION: "terminal:start-session";
    readonly TERMINAL_GET_SESSION: "terminal:get-session";
    readonly TERMINAL_WRITE: "terminal:write";
    readonly TERMINAL_RESIZE: "terminal:resize";
    readonly TERMINAL_OUTPUT: "terminal:output";
    readonly TERMINAL_STATUS: "terminal:status";
    readonly TERMINAL_EXIT: "terminal:exit";
};
export interface WorkspaceAPI {
    getState(): Promise<AppState>;
    getRole(): Promise<PhysicalWindowRole>;
    createTask(title: string): Promise<{
        id: string;
        title: string;
    }>;
    deleteTask(taskId: string): Promise<void>;
    updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>;
    setActiveTask(taskId: string | null): Promise<void>;
    resetTokenUsage(): Promise<void>;
    addLog(level: LogLevel, source: LogSource, message: string, taskId?: string): Promise<void>;
    attachments: {
        importDocuments(taskId: string, documents: DocumentImportRequest[]): Promise<DocumentInvocationAttachment[]>;
    };
    artifacts: {
        create(input: CreateArtifactInput): Promise<ArtifactRecord>;
        get(artifactId: string): Promise<ArtifactRecord | null>;
        list(): Promise<ArtifactRecord[]>;
        setActive(artifactId: string | null): Promise<ArtifactRecord | null>;
        getActive(): Promise<ArtifactRecord | null>;
        delete(artifactId: string, deletedBy?: string): Promise<{
            deletedArtifactId: string;
            nextActiveArtifact: ArtifactRecord | null;
        }>;
        replaceContent(input: {
            artifactId?: string | null;
            content: string;
            updatedBy?: string;
        }): Promise<ArtifactRecord>;
        appendContent(input: {
            artifactId?: string | null;
            content: string;
            updatedBy?: string;
        }): Promise<ArtifactRecord>;
    };
    document: {
        openArtifact(artifactId: string): Promise<DocumentArtifactView>;
        getCurrent(): Promise<DocumentArtifactView | null>;
        getArtifact(artifactId: string): Promise<DocumentArtifactView>;
        listArtifacts(): Promise<DocumentArtifactSummary[]>;
        setCurrent(artifactId: string | null): Promise<DocumentArtifactView | null>;
    };
    applyExecutionPreset(preset: ExecutionLayoutPreset): Promise<void>;
    setSplitRatio(ratio: number): Promise<void>;
    actions: {
        submit(input: SurfaceActionInput): Promise<SurfaceActionRecord>;
        cancelQueued(actionId: string): Promise<SurfaceActionRecord>;
        listRecent(limit?: number): Promise<SurfaceActionRecord[]>;
        listByTarget(target: 'browser' | 'terminal', limit?: number): Promise<SurfaceActionRecord[]>;
        listByTask(taskId: string): Promise<SurfaceActionRecord[]>;
        getQueueDiagnostics(): Promise<{
            browser: {
                active: string | null;
                queueLength: number;
            };
            terminal: {
                active: string | null;
                queueLength: number;
            };
        }>;
        onUpdate(callback: (record: SurfaceActionRecord) => void): void;
    };
    onStateUpdate(callback: (state: AppState) => void): void;
    onEvent(callback: (type: AppEventType, payload: unknown) => void): void;
    browser: {
        getState(): Promise<BrowserState>;
        getHistory(): Promise<BrowserHistoryEntry[]>;
        clearHistory(): Promise<void>;
        clearData(): Promise<void>;
        clearSiteData(origin?: string): Promise<{
            origin: string;
            cookiesCleared: number;
        }>;
        reportBounds(bounds: {
            x: number;
            y: number;
            width: number;
            height: number;
        }): Promise<void>;
        getTabs(): Promise<TabInfo[]>;
        captureTabSnapshot(tabId?: string): Promise<BrowserSnapshot>;
        getActionableElements(tabId?: string): Promise<BrowserActionableElement[]>;
        getFormModel(tabId?: string): Promise<BrowserFormModel[]>;
        getConsoleEvents(tabId?: string, since?: number): Promise<BrowserConsoleEvent[]>;
        getNetworkEvents(tabId?: string, since?: number): Promise<BrowserNetworkEvent[]>;
        getOperationLedger(limit?: number): Promise<BrowserOperationLedgerEntry[]>;
        replayOperation(request: BrowserReplayRequest): Promise<{
            replayedOperationId: string | null;
            sourceOperationId: string;
            validation: BrowserTargetValidationResult | null;
            result: {
                summary: string;
                data: Record<string, unknown>;
            } | null;
        }>;
        recordFinding(input: {
            taskId: string;
            tabId?: string;
            title: string;
            summary: string;
            severity?: BrowserFinding['severity'];
            evidence?: string[];
            snapshotId?: string | null;
        }): Promise<BrowserFinding>;
        getTaskMemory(taskId: string): Promise<BrowserTaskMemory>;
        getSiteStrategy(origin: string): Promise<BrowserSiteStrategy | null>;
        saveSiteStrategy(input: Partial<BrowserSiteStrategy> & {
            origin: string;
        }): Promise<BrowserSiteStrategy>;
        exportSurfaceEvalFixture(input: {
            name: string;
            tabId?: string;
        }): Promise<BrowserSurfaceEvalFixture>;
        addBookmark(url: string, title: string): Promise<BookmarkEntry>;
        removeBookmark(bookmarkId: string): Promise<void>;
        getBookmarks(): Promise<BookmarkEntry[]>;
        zoomIn(): Promise<void>;
        zoomOut(): Promise<void>;
        zoomReset(): Promise<void>;
        findInPage(query: string): Promise<void>;
        findNext(): Promise<void>;
        findPrevious(): Promise<void>;
        stopFind(): Promise<void>;
        toggleDevTools(): Promise<void>;
        getSettings(): Promise<BrowserSettings>;
        updateSettings(settings: Partial<BrowserSettings>): Promise<void>;
        getAuthDiagnostics(): Promise<BrowserAuthDiagnostics>;
        clearGoogleAuthState(): Promise<{
            cleared: number;
        }>;
        loadExtension(path: string): Promise<ExtensionInfo | null>;
        removeExtension(extensionId: string): Promise<void>;
        getExtensions(): Promise<ExtensionInfo[]>;
        getDownloads(): Promise<BrowserDownloadState[]>;
        cancelDownload(downloadId: string): Promise<void>;
        clearDownloads(): Promise<void>;
        reimportCookies(): Promise<{
            imported: number;
            failed: number;
            domains: string[];
        }>;
        onStateUpdate(callback: (state: BrowserState) => void): void;
        onNavUpdate(callback: (nav: BrowserNavigationState) => void): void;
        onFindUpdate(callback: (find: {
            activeMatch: number;
            totalMatches: number;
        }) => void): void;
    };
    model: {
        invoke(taskId: string, prompt: string, owner?: string, options?: AgentInvocationOptions): Promise<any>;
        cancel(taskId: string): Promise<boolean>;
        getProviders(): Promise<Record<string, any>>;
        getTaskMemory(taskId: string): Promise<TaskMemoryRecord>;
        resolve(prompt: string, explicitOwner?: string, options?: AgentInvocationOptions): Promise<string>;
        runIntentProgram(taskId: string, input: {
            instructions: Array<Record<string, unknown>>;
            tabId?: string;
            failFast?: boolean;
        }): Promise<any>;
        onProgress(callback: (progress: any) => void): void;
    };
    terminal: {
        startSession(cols?: number, rows?: number): Promise<TerminalSessionInfo>;
        getSession(): Promise<TerminalSessionInfo | null>;
        write(data: string): Promise<void>;
        resize(cols: number, rows: number): Promise<void>;
        onOutput(callback: (data: string) => void): void;
        onStatus(callback: (session: TerminalSessionInfo) => void): void;
        onExit(callback: (exitCode: number) => void): void;
    };
    removeAllListeners(): void;
}
