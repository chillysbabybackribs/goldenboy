import type { AppState } from '../../shared/types/appState';
import type { ArtifactRecord } from '../../shared/types/artifacts';
import type { DocumentArtifactSummary, DocumentArtifactView } from '../../shared/types/document';
import {
  buildSandboxedHtmlDocument,
  formatArtifactMeta,
  parseCsvRows,
  renderMarkdownPreview,
} from './preview.js';
import { getDocumentRenderCheckpoint, shouldRefreshDocumentView, type DocumentRenderCheckpoint } from './renderState.js';

const artifactList = document.getElementById('artifactList') as HTMLDivElement;
const artifactTitle = document.getElementById('artifactTitle') as HTMLHeadingElement;
const artifactFormat = document.getElementById('artifactFormat') as HTMLSpanElement;
const artifactMeta = document.getElementById('artifactMeta') as HTMLDivElement;
const previewKind = document.getElementById('previewKind') as HTMLDivElement;
const previewEmpty = document.getElementById('previewEmpty') as HTMLDivElement;
const previewContainer = document.getElementById('previewContainer') as HTMLDivElement;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const deleteBtn = document.getElementById('deleteBtn') as HTMLButtonElement;
const docShell = document.querySelector('.doc-shell') as HTMLDivElement;
const docHeader = document.querySelector('.doc-header') as HTMLDivElement;
let latestState: AppState | null = null;
let lastRenderedCheckpoint: DocumentRenderCheckpoint | null = null;

function mapStateArtifactToSummary(artifact: ArtifactRecord): DocumentArtifactSummary {
  return {
    id: artifact.id,
    title: artifact.title,
    format: artifact.format,
    createdAt: artifact.createdAt,
    createdBy: artifact.createdBy,
    updatedAt: artifact.updatedAt,
    lastUpdatedBy: artifact.lastUpdatedBy,
    status: artifact.status,
    linkedTaskIds: [...artifact.linkedTaskIds],
    previewable: artifact.previewable,
    exportable: artifact.exportable,
    archived: artifact.archived,
  };
}

function getWorkspaceAPI(): WorkspaceAPI | null {
  return window.workspaceAPI ?? null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatUpdatedAt(value: number): string {
  return new Date(value).toLocaleString();
}

function setPreviewEmpty(message: string): void {
  previewEmpty.hidden = false;
  previewEmpty.textContent = message;
  previewKind.hidden = true;
  previewContainer.hidden = true;
  previewContainer.replaceChildren();
  artifactFormat.hidden = true;
  deleteBtn.disabled = true;
  docShell.classList.remove('has-active-artifact');
  docHeader.classList.remove('has-active-artifact');
}

function renderArtifactList(artifacts: DocumentArtifactSummary[], activeArtifactId: string | null): void {
  artifactList.innerHTML = '';
  if (artifacts.length === 0) {
    artifactList.innerHTML = '<div class="doc-artifact-empty">No workspace artifacts are available yet.</div>';
    return;
  }

  for (const artifact of artifacts) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'doc-artifact-item' + (artifact.id === activeArtifactId ? ' active' : '');
    item.title = artifact.id === activeArtifactId ? 'Current active artifact' : 'Select artifact';

    const title = document.createElement('div');
    title.className = 'doc-artifact-item-title';
    title.textContent = artifact.title;

    const meta = document.createElement('div');
    meta.className = 'doc-artifact-item-meta';
    meta.innerHTML = [
      `<span>${escapeHtml(artifact.format)}</span>`,
      `<span>${escapeHtml(formatUpdatedAt(artifact.updatedAt))}</span>`,
      `<span>${escapeHtml(artifact.status)}</span>`,
    ].join('');

    item.append(title, meta);
    item.addEventListener('click', () => { void setCurrentArtifact(artifact.id); });
    artifactList.appendChild(item);
  }
}

function renderPreview(view: DocumentArtifactView | null): void {
  if (!view) {
    artifactTitle.textContent = 'No artifact selected';
    artifactMeta.textContent = 'Open an artifact from the Command Center to inspect it here.';
    setPreviewEmpty('No artifact loaded.');
    lastRenderedCheckpoint = { artifactId: null, updatedAt: null };
    return;
  }

  artifactTitle.textContent = view.artifact.title;
  artifactFormat.hidden = false;
  artifactFormat.textContent = view.artifact.format;
  artifactMeta.textContent = formatArtifactMeta(view);
  deleteBtn.disabled = false;
  docShell.classList.add('has-active-artifact');
  docHeader.classList.add('has-active-artifact');
  previewEmpty.hidden = true;
  previewKind.hidden = false;
  previewContainer.hidden = false;
  previewKind.textContent = `${view.artifact.format.toUpperCase()} preview`;
  previewContainer.replaceChildren();
  document.title = `${view.artifact.title} · Document`;
  lastRenderedCheckpoint = {
    artifactId: view.artifact.id,
    updatedAt: view.artifact.updatedAt,
  };

  if (view.artifact.format === 'md') {
    const markdown = document.createElement('div');
    markdown.className = 'doc-markdown';
    markdown.innerHTML = renderMarkdownPreview(view.content);
    previewContainer.appendChild(markdown);
    return;
  }

  if (view.artifact.format === 'txt') {
    const pre = document.createElement('pre');
    pre.className = 'doc-preview-text';
    pre.textContent = view.content;
    previewContainer.appendChild(pre);
    return;
  }

  if (view.artifact.format === 'html') {
    const frame = document.createElement('iframe');
    frame.className = 'doc-html-frame';
    frame.setAttribute('sandbox', '');
    frame.referrerPolicy = 'no-referrer';
    frame.title = `${view.artifact.title} HTML preview`;
    frame.srcdoc = buildSandboxedHtmlDocument(view.content);
    previewContainer.appendChild(frame);
    return;
  }

  if (view.artifact.format === 'csv') {
    const rows = parseCsvRows(view.content);
    if (rows.length === 0) {
      setPreviewEmpty('CSV artifact is empty.');
      return;
    }

    const table = document.createElement('table');
    table.className = 'doc-csv-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const cell of rows[0]) {
      const th = document.createElement('th');
      th.textContent = cell;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of rows.slice(1)) {
      const tr = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    previewContainer.appendChild(table);
    return;
  }

  setPreviewEmpty(`Unsupported artifact format: ${view.artifact.format}`);
}

async function deleteCurrentArtifact(): Promise<void> {
  const workspaceAPI = getWorkspaceAPI();
  if (!workspaceAPI) return;
  const current = await workspaceAPI.document.getCurrent();
  if (!current) return;
  if (!window.confirm(`Delete artifact "${current.artifact.title}"? This removes its managed file and registry entry.`)) {
    return;
  }

  try {
    await workspaceAPI.artifacts.delete(current.artifact.id, 'user');
    latestState = await workspaceAPI.getState();
    await refreshDocumentView({ force: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setPreviewEmpty(`Failed to delete artifact: ${message}`);
  }
}

async function refreshDocumentView(options?: { force?: boolean }): Promise<void> {
  const workspaceAPI = getWorkspaceAPI();
  if (!workspaceAPI) return;

  try {
    const state = latestState ?? await workspaceAPI.getState();
    latestState = state;
    const checkpoint = getDocumentRenderCheckpoint(state);
    if (!options?.force && !shouldRefreshDocumentView(lastRenderedCheckpoint, checkpoint)) {
      return;
    }

    const artifacts = state.artifacts
      .slice()
      .sort((a: ArtifactRecord, b: ArtifactRecord) => b.updatedAt - a.updatedAt)
      .map(mapStateArtifactToSummary);

    renderArtifactList(artifacts, checkpoint.artifactId);

    const current = checkpoint.artifactId
      ? await workspaceAPI.document.getCurrent()
      : null;
    renderPreview(current);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setPreviewEmpty(`Failed to load artifact: ${message}`);
  }
}

async function setCurrentArtifact(artifactId: string): Promise<void> {
  const workspaceAPI = getWorkspaceAPI();
  if (!workspaceAPI) return;
  try {
    const view = await workspaceAPI.document.setCurrent(artifactId);
    latestState = await workspaceAPI.getState();
    const checkpoint = getDocumentRenderCheckpoint(latestState);
    const artifacts = latestState.artifacts
      .slice()
      .sort((a: ArtifactRecord, b: ArtifactRecord) => b.updatedAt - a.updatedAt)
      .map(mapStateArtifactToSummary);

    renderArtifactList(artifacts, checkpoint.artifactId);
    renderPreview(view);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setPreviewEmpty(`Failed to switch artifact: ${message}`);
  }
}

refreshBtn.addEventListener('click', () => {
  void refreshDocumentView({ force: true });
});

deleteBtn.addEventListener('click', () => {
  void deleteCurrentArtifact();
});

window.addEventListener('DOMContentLoaded', () => {
  const workspaceAPI = getWorkspaceAPI();
  if (!workspaceAPI) {
    setPreviewEmpty('Workspace API unavailable.');
    return;
  }

  workspaceAPI.onStateUpdate((state) => {
    latestState = state;
    void refreshDocumentView();
  });

  void refreshDocumentView();
});
