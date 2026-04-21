import { BrowserWindow, WebContentsView } from 'electron';
import type { PhysicalWindowRole } from '../../shared/types/windowRoles';

type ViewBounds = { x: number; y: number; width: number; height: number };

type LayoutTabEntry = {
  id: string;
  view: WebContentsView;
};

function areViewBoundsEqual(a: ViewBounds, b: ViewBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

export class BrowserLayoutService {
  private hostWindow: BrowserWindow | null = null;
  private hostRole: PhysicalWindowRole | null = null;
  private currentBounds: ViewBounds = { x: 0, y: 0, width: 0, height: 0 };
  private attachedTabIds = new Set<string>();
  private appliedBoundsByTabId = new Map<string, ViewBounds>();
  private reportedBoundsByRole = new Map<PhysicalWindowRole, ViewBounds>();

  setHostWindow(hostWindow: BrowserWindow, hostRole: PhysicalWindowRole): void {
    this.hostWindow = hostWindow;
    this.hostRole = hostRole;
  }

  rehostWindow(
    hostWindow: BrowserWindow,
    hostRole: PhysicalWindowRole,
    tabs: Map<string, LayoutTabEntry>,
  ): void {
    const previousHost = this.hostWindow;
    const hostChanged = previousHost !== hostWindow || this.hostRole !== hostRole;

    if (hostChanged && previousHost && !previousHost.isDestroyed()) {
      for (const tabId of this.attachedTabIds) {
        const entry = tabs.get(tabId);
        if (!entry) continue;
        try { previousHost.contentView.removeChildView(entry.view); } catch {}
      }
    }

    this.hostWindow = hostWindow;
    this.hostRole = hostRole;
    const nextBounds = this.reportedBoundsByRole.get(hostRole);
    if (nextBounds) {
      this.currentBounds = nextBounds;
    }

    if (hostChanged) {
      this.attachedTabIds.clear();
      this.appliedBoundsByTabId.clear();
    }
  }

  hasHostWindow(): boolean {
    return Boolean(this.hostWindow && !this.hostWindow.isDestroyed());
  }

  getHostRole(): PhysicalWindowRole | null {
    return this.hostRole;
  }

  detachTab(tabId: string, view: WebContentsView): void {
    if (this.hostWindow && !this.hostWindow.isDestroyed()) {
      try { this.hostWindow.contentView.removeChildView(view); } catch {}
    }
    this.attachedTabIds.delete(tabId);
    this.appliedBoundsByTabId.delete(tabId);
  }

  setBounds(bounds: ViewBounds, sourceRole?: PhysicalWindowRole): boolean {
    if (sourceRole) {
      this.reportedBoundsByRole.set(sourceRole, bounds);
    }
    if (sourceRole && this.hostRole && sourceRole !== this.hostRole) return false;
    if (areViewBoundsEqual(this.currentBounds, bounds)) return false;
    this.currentBounds = bounds;
    return true;
  }

  applyLayout(input: {
    tabs: Map<string, LayoutTabEntry>;
    activeTabId: string;
    splitLeftTabId: string | null;
    splitRightTabId: string | null;
  }): void {
    if (!this.hostWindow || this.hostWindow.isDestroyed()) return;
    if (input.tabs.size === 0) return;

    const x = Math.round(this.currentBounds.x);
    const y = Math.round(this.currentBounds.y);
    const width = Math.max(1, Math.round(this.currentBounds.width));
    const height = Math.max(1, Math.round(this.currentBounds.height));
    const nextVisibleEntries: Array<{ entry: LayoutTabEntry; bounds: ViewBounds }> = [];

    if (input.splitLeftTabId && input.splitRightTabId) {
      const leftEntry = input.tabs.get(input.splitLeftTabId);
      const rightEntry = input.tabs.get(input.splitRightTabId);
      if (leftEntry && rightEntry) {
        const dividerWidth = width >= 220 ? 2 : 0;
        const availableWidth = Math.max(1, width - dividerWidth);
        const leftWidth = Math.max(1, Math.floor(availableWidth / 2));
        const rightWidth = Math.max(1, availableWidth - leftWidth);
        nextVisibleEntries.push(
          { entry: leftEntry, bounds: { x, y, width: leftWidth, height } },
          { entry: rightEntry, bounds: { x: x + leftWidth + dividerWidth, y, width: rightWidth, height } },
        );
      }
    } else {
      const entry = input.tabs.get(input.activeTabId);
      if (!entry) return;
      nextVisibleEntries.push({ entry, bounds: { x, y, width, height } });
    }

    if (nextVisibleEntries.length === 0) return;

    const nextAttachedIds = new Set(nextVisibleEntries.map(({ entry }) => entry.id));
    for (const tabId of this.attachedTabIds) {
      if (nextAttachedIds.has(tabId)) continue;
      const staleEntry = input.tabs.get(tabId);
      if (staleEntry) {
        try { this.hostWindow.contentView.removeChildView(staleEntry.view); } catch {}
      }
      this.appliedBoundsByTabId.delete(tabId);
    }

    for (const { entry, bounds } of nextVisibleEntries) {
      if (!this.attachedTabIds.has(entry.id)) {
        this.hostWindow.contentView.addChildView(entry.view);
      }
      const previousBounds = this.appliedBoundsByTabId.get(entry.id);
      if (!previousBounds || !areViewBoundsEqual(previousBounds, bounds)) {
        entry.view.setBounds(bounds);
        this.appliedBoundsByTabId.set(entry.id, bounds);
      }
    }

    this.attachedTabIds = nextAttachedIds;
  }

  clear(): void {
    this.attachedTabIds.clear();
    this.appliedBoundsByTabId.clear();
    this.hostWindow = null;
    this.hostRole = null;
    this.reportedBoundsByRole.clear();
    this.currentBounds = { x: 0, y: 0, width: 0, height: 0 };
  }
}
