import { WindowBounds } from '../../shared/types/appState';
import { PhysicalWindowRole } from '../../shared/types/windowRoles';
type LayoutBounds = Record<PhysicalWindowRole, WindowBounds & {
    displayId: number;
}>;
export declare function getDefaultWindowBounds(): LayoutBounds;
export {};
