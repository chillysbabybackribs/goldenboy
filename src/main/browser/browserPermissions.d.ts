import { BrowserPermissionType, BrowserPermissionDecision } from '../../shared/types/browser';
export declare function resolvePermission(permission: BrowserPermissionType): BrowserPermissionDecision;
export declare function classifyPermission(electronPermission: string): BrowserPermissionType;
