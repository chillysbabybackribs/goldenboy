// ═══════════════════════════════════════════════════════════════════════════
// Browser Permissions — Deliberate permission policy for the browser surface
// ═══════════════════════════════════════════════════════════════════════════
//
// Policy: Default-deny with explicit grants for safe permissions.
// All requests are logged and observable via the event bus.
//
// Extension path: This module is where per-site permission overrides
// or user-configurable policies can be added in the future.

import { BrowserPermissionType, BrowserPermissionDecision } from '../../shared/types/browser';

// Permissions granted by default — safe, non-intrusive
const AUTO_GRANT: Set<string> = new Set([
  'clipboard-sanitized-write',
  'fullscreen',
  'pointerLock',
  'window-management',
]);

// Permissions explicitly denied — require future UI for user consent
const AUTO_DENY: Set<string> = new Set([
  'geolocation',
  'notifications',
  'midi',
  'openExternal',
]);

export function resolvePermission(permission: BrowserPermissionType): BrowserPermissionDecision {
  if (AUTO_GRANT.has(permission)) return 'granted';
  if (AUTO_DENY.has(permission)) return 'denied';
  // Default deny for unknown permissions
  return 'denied';
}

export function classifyPermission(electronPermission: string): BrowserPermissionType {
  const map: Record<string, BrowserPermissionType> = {
    'media': 'media',
    'geolocation': 'geolocation',
    'notifications': 'notifications',
    'midi': 'midi',
    'pointerLock': 'pointerLock',
    'fullscreen': 'fullscreen',
    'openExternal': 'openExternal',
    'clipboard-read': 'clipboard-read',
    'clipboard-sanitized-write': 'clipboard-sanitized-write',
    'window-management': 'window-management',
  };
  return map[electronPermission] || 'unknown';
}
