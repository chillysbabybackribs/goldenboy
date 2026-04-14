export const IPC_CHANNELS = {
  GET_STATE: 'workspace:get-state',
  GET_ROLE: 'workspace:get-role',
  EMIT_EVENT: 'workspace:emit-event',
  STATE_UPDATE: 'workspace:state-update',
  EVENT_BROADCAST: 'workspace:event-broadcast',
  CREATE_TASK: 'workspace:create-task',
  DELETE_TASK: 'workspace:delete-task',
  UPDATE_TASK_STATUS: 'workspace:update-task-status',
  SET_ACTIVE_TASK: 'workspace:set-active-task',
  ADD_LOG: 'workspace:add-log',

  // Execution split control (replaces old layout channels)
  APPLY_EXECUTION_PRESET: 'workspace:apply-execution-preset',
  SET_SPLIT_RATIO: 'workspace:set-split-ratio',

  // Surface action channels
  SUBMIT_SURFACE_ACTION: 'workspace:submit-surface-action',
  CANCEL_QUEUED_ACTION: 'workspace:cancel-queued-action',
  GET_RECENT_ACTIONS: 'workspace:get-recent-actions',
  GET_ACTIONS_BY_TARGET: 'workspace:get-actions-by-target',
  GET_ACTIONS_BY_TASK: 'workspace:get-actions-by-task',
  GET_QUEUE_DIAGNOSTICS: 'workspace:get-queue-diagnostics',
  SURFACE_ACTION_UPDATE: 'workspace:surface-action-update',

  // Browser runtime channels (queries, management, UI features)
  BROWSER_GET_STATE: 'browser:get-state',
  BROWSER_GET_HISTORY: 'browser:get-history',
  BROWSER_CLEAR_HISTORY: 'browser:clear-history',
  BROWSER_CLEAR_DATA: 'browser:clear-data',
  BROWSER_CLEAR_SITE_DATA: 'browser:clear-site-data',
  BROWSER_REPORT_BOUNDS: 'browser:report-bounds',
  BROWSER_GET_TABS: 'browser:get-tabs',
  BROWSER_CAPTURE_TAB_SNAPSHOT: 'browser:capture-tab-snapshot',
  BROWSER_GET_ACTIONABLE_ELEMENTS: 'browser:get-actionable-elements',
  BROWSER_GET_FORM_MODEL: 'browser:get-form-model',
  BROWSER_GET_CONSOLE_EVENTS: 'browser:get-console-events',
  BROWSER_GET_NETWORK_EVENTS: 'browser:get-network-events',
  BROWSER_GET_OPERATION_LEDGER: 'browser:get-operation-ledger',
  BROWSER_RECORD_FINDING: 'browser:record-finding',
  BROWSER_GET_TASK_MEMORY: 'browser:get-task-memory',
  BROWSER_GET_SITE_STRATEGY: 'browser:get-site-strategy',
  BROWSER_SAVE_SITE_STRATEGY: 'browser:save-site-strategy',
  BROWSER_EXPORT_SURFACE_EVAL_FIXTURE: 'browser:export-surface-eval-fixture',

  // Bookmarks
  BROWSER_ADD_BOOKMARK: 'browser:add-bookmark',
  BROWSER_REMOVE_BOOKMARK: 'browser:remove-bookmark',
  BROWSER_GET_BOOKMARKS: 'browser:get-bookmarks',
  BROWSER_SPLIT_TAB: 'browser:split-tab',
  BROWSER_CLEAR_SPLIT_VIEW: 'browser:clear-split-view',

  // Zoom
  BROWSER_ZOOM_IN: 'browser:zoom-in',
  BROWSER_ZOOM_OUT: 'browser:zoom-out',
  BROWSER_ZOOM_RESET: 'browser:zoom-reset',

  // Find in page
  BROWSER_FIND_IN_PAGE: 'browser:find-in-page',
  BROWSER_FIND_NEXT: 'browser:find-next',
  BROWSER_FIND_PREVIOUS: 'browser:find-previous',
  BROWSER_STOP_FIND: 'browser:stop-find',

  // DevTools
  BROWSER_TOGGLE_DEVTOOLS: 'browser:toggle-devtools',

  // Settings
  BROWSER_GET_SETTINGS: 'browser:get-settings',
  BROWSER_UPDATE_SETTINGS: 'browser:update-settings',
  BROWSER_GET_AUTH_DIAGNOSTICS: 'browser:get-auth-diagnostics',
  BROWSER_CLEAR_GOOGLE_AUTH_STATE: 'browser:clear-google-auth-state',

  // Extensions
  BROWSER_LOAD_EXTENSION: 'browser:load-extension',
  BROWSER_REMOVE_EXTENSION: 'browser:remove-extension',
  BROWSER_GET_EXTENSIONS: 'browser:get-extensions',

  // Downloads
  BROWSER_GET_DOWNLOADS: 'browser:get-downloads',
  BROWSER_CANCEL_DOWNLOAD: 'browser:cancel-download',
  BROWSER_CLEAR_DOWNLOADS: 'browser:clear-downloads',

  // Browser state push channels (main -> renderer)
  BROWSER_STATE_UPDATE: 'browser:state-update',
  BROWSER_NAV_UPDATE: 'browser:nav-update',
  BROWSER_FIND_UPDATE: 'browser:find-update',

  // Debug: disk cache test
  DEBUG_TEST_DISK_EXTRACT: 'debug:test-disk-extract',

  // Model channels
  MODEL_INVOKE: 'model:invoke',
  MODEL_CANCEL: 'model:cancel',
  MODEL_GET_PROVIDERS: 'model:get-providers',
  MODEL_GET_TASK_MEMORY: 'model:get-task-memory',
  MODEL_RESOLVE: 'model:resolve',
  MODEL_HANDOFF: 'model:handoff',
  MODEL_RUN_INTENT_PROGRAM: 'model:run-intent-program',
  MODEL_PROGRESS: 'model:progress',

  // Terminal session channels
  TERMINAL_START_SESSION: 'terminal:start-session',
  TERMINAL_GET_SESSION: 'terminal:get-session',
  TERMINAL_WRITE: 'terminal:write',
  TERMINAL_RESIZE: 'terminal:resize',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_STATUS: 'terminal:status',
  TERMINAL_EXIT: 'terminal:exit',
  TERMINAL_CAPTURE_SCROLLBACK: 'terminal:capture-scrollback',
} as const;
