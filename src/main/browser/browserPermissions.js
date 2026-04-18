"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Browser Permissions — Deliberate permission policy for the browser surface
// ═══════════════════════════════════════════════════════════════════════════
//
// Policy: Default-deny with explicit grants for safe permissions.
// All requests are logged and observable via the event bus.
//
// Extension path: This module is where per-site permission overrides
// or user-configurable policies can be added in the future.
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePermission = resolvePermission;
exports.classifyPermission = classifyPermission;
// Permissions granted by default — safe, non-intrusive
const AUTO_GRANT = new Set([
    'clipboard-sanitized-write',
    'fullscreen',
    'pointerLock',
    'window-management',
]);
// Permissions explicitly denied — require future UI for user consent
const AUTO_DENY = new Set([
    'geolocation',
    'notifications',
    'midi',
    'openExternal',
]);
function resolvePermission(permission) {
    if (AUTO_GRANT.has(permission))
        return 'granted';
    if (AUTO_DENY.has(permission))
        return 'denied';
    // Default deny for unknown permissions
    return 'denied';
}
function classifyPermission(electronPermission) {
    const map = {
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
//# sourceMappingURL=browserPermissions.js.map