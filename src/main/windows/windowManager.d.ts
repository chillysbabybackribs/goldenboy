import { BrowserWindow } from 'electron';
import { PhysicalWindowRole } from '../../shared/types/windowRoles';
export declare function createAllWindows(): void;
export declare function ensureWindow(role: PhysicalWindowRole, options?: {
    showOnReady?: boolean;
}): BrowserWindow;
export declare function getWindowByRole(role: PhysicalWindowRole): BrowserWindow | undefined;
export declare function getRoleByWebContentsId(webContentsId: number): PhysicalWindowRole | undefined;
export declare function showAllWindows(): void;
export declare function focusWindow(role: PhysicalWindowRole, options?: {
    fullScreen?: boolean;
    maximize?: boolean;
}): void;
export declare function applyDefaultBounds(): void;
export declare function setAppQuitting(): void;
export declare function destroyAllWindows(): void;
