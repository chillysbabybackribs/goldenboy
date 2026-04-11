// Physical OS windows
export const PHYSICAL_WINDOW_ROLES = ['command', 'execution'] as const;
export type PhysicalWindowRole = typeof PHYSICAL_WINDOW_ROLES[number];

// Logical surfaces (panes within windows)
export const SURFACE_ROLES = ['browser', 'terminal'] as const;
export type SurfaceRole = typeof SURFACE_ROLES[number];

// Log sources can be a surface role, 'system', or a model provider
export type LogSourceRole = SurfaceRole | 'system' | 'codex' | 'haiku' | 'sonnet';
