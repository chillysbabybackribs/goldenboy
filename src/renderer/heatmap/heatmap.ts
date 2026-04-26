type BrowserTabHeatmapApi = {
  codeHeatmap?: {
    getSnapshot?: () => Promise<CodeHeatmapSnapshot>;
    onUpdate?: (callback: (snapshot: CodeHeatmapSnapshot) => void) => void;
  };
};

const api = ((window as typeof window & { workspaceAPI?: BrowserTabHeatmapApi }).workspaceAPI ?? null);

const watcherStateEl = document.getElementById('watcherState') as HTMLElement;
const directoryCountEl = document.getElementById('directoryCount') as HTMLElement;
const totalEditsEl = document.getElementById('totalEdits') as HTMLElement;
const updatedAtEl = document.getElementById('updatedAt') as HTMLElement;
const hottestFilesEl = document.getElementById('hottestFiles') as HTMLElement;
const hottestDirectoriesEl = document.getElementById('hottestDirectories') as HTMLElement;
const recentEditsEl = document.getElementById('recentEdits') as HTMLElement;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTimestamp(timestamp: number | null): string {
  if (!timestamp) return 'Waiting for first event';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(timestamp);
}

function renderHeatList(container: HTMLElement, nodes: CodeHeatmapNode[], noun: string): void {
  if (!nodes.length) {
    container.innerHTML = `<div class="empty">No ${noun} activity recorded yet.</div>`;
    return;
  }
  container.innerHTML = nodes.map((node) => {
    const percent = Math.max(6, Math.round(node.intensity * 100));
    return `
      <article class="heat-item">
        <div class="heat-item-top">
          <strong class="path">${escapeHtml(node.path)}</strong>
          <span class="meta">${node.editCount} edits</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${percent}%"></div></div>
        <div class="meta">Last change ${escapeHtml(formatTimestamp(node.lastEditedAt))}</div>
      </article>
    `;
  }).join('');
}

function renderRecentEdits(events: CodeHeatmapSnapshot['recentEdits']): void {
  if (!events.length) {
    recentEditsEl.innerHTML = '<div class="empty">No edits observed yet.</div>';
    return;
  }
  recentEditsEl.innerHTML = events.slice(0, 18).map((event) => `
    <article class="recent-item">
      <strong class="path">${escapeHtml(event.path)}</strong>
      <span class="timestamp">${escapeHtml(formatTimestamp(event.timestamp))}</span>
    </article>
  `).join('');
}

function renderSnapshot(snapshot: CodeHeatmapSnapshot): void {
  watcherStateEl.textContent = snapshot.watching ? 'Watching' : 'Paused';
  directoryCountEl.textContent = String(snapshot.watchedDirectoryCount);
  totalEditsEl.textContent = String(snapshot.totalEdits);
  updatedAtEl.textContent = snapshot.updatedAt ? `Updated ${formatTimestamp(snapshot.updatedAt)}` : 'Waiting for first event';
  renderHeatList(hottestFilesEl, snapshot.hottestFiles, 'file');
  renderHeatList(hottestDirectoriesEl, snapshot.hottestDirectories, 'directory');
  renderRecentEdits(snapshot.recentEdits);
}

async function init(): Promise<void> {
  const heatmapApi = api?.codeHeatmap;
  if (!heatmapApi?.getSnapshot) {
    watcherStateEl.textContent = 'Unavailable';
    hottestFilesEl.innerHTML = '<div class="empty">Heatmap API is not available in this browser tab.</div>';
    hottestDirectoriesEl.innerHTML = '<div class="empty">Heatmap API is not available in this browser tab.</div>';
    recentEditsEl.innerHTML = '<div class="empty">Heatmap API is not available in this browser tab.</div>';
    return;
  }

  const initial = await heatmapApi.getSnapshot();
  renderSnapshot(initial);
  heatmapApi.onUpdate?.((snapshot) => {
    renderSnapshot(snapshot);
  });
}

void init();
