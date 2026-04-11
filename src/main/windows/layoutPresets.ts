import { screen } from 'electron';
import { WindowBounds } from '../../shared/types/appState';
import { PhysicalWindowRole } from '../../shared/types/windowRoles';

type LayoutBounds = Record<PhysicalWindowRole, WindowBounds & { displayId: number }>;

function classifyDisplays(): { topDisplay: Electron.Display; bottomDisplay: Electron.Display; isSingleMonitor: boolean } {
  const displays = screen.getAllDisplays();

  if (displays.length === 1) {
    return { topDisplay: displays[0], bottomDisplay: displays[0], isSingleMonitor: true };
  }

  const primary = screen.getPrimaryDisplay();
  const external = displays.find((d) => d.id !== primary.id) ?? primary;

  return {
    topDisplay: external,
    bottomDisplay: primary,
    isSingleMonitor: false,
  };
}

export function getDefaultWindowBounds(): LayoutBounds {
  const { topDisplay, bottomDisplay, isSingleMonitor } = classifyDisplays();
  const top = topDisplay.workArea;
  const bottom = bottomDisplay.workArea;

  if (isSingleMonitor) {
    const totalH = top.height;
    const commandH = Math.floor(totalH * 0.33);
    const executionH = totalH - commandH;

    return {
      execution: { x: top.x, y: top.y, width: top.width, height: executionH, displayId: topDisplay.id },
      command: { x: bottom.x, y: top.y + executionH, width: top.width, height: commandH, displayId: bottomDisplay.id },
    };
  }

  return {
    execution: { x: top.x, y: top.y, width: top.width, height: top.height, displayId: topDisplay.id },
    command: { x: bottom.x, y: bottom.y, width: bottom.width, height: bottom.height, displayId: bottomDisplay.id },
  };
}
