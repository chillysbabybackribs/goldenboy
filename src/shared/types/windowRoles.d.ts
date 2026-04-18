import type { ProviderId } from './model';
export declare const PHYSICAL_WINDOW_ROLES: readonly ["command", "execution", "document"];
export type PhysicalWindowRole = typeof PHYSICAL_WINDOW_ROLES[number];
export declare const SURFACE_ROLES: readonly ["browser", "terminal"];
export type SurfaceRole = typeof SURFACE_ROLES[number];
export type LogSourceRole = SurfaceRole | 'system' | ProviderId;
