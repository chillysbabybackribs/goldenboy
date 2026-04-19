import { Menu, MenuItem } from 'electron';

export type BrowserContextMenuDeps = {
  currentUrl: string;
  params: Electron.ContextMenuParams;
  openInNewTab: (url: string) => void;
  copyText: (text: string) => void;
  openPageSource: (url: string) => void;
  inspectElement: (x: number, y: number) => void;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
};

export function buildBrowserContextMenu(deps: BrowserContextMenuDeps): Menu {
  const {
    currentUrl,
    params,
    openInNewTab,
    copyText,
    openPageSource,
    inspectElement,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    reload,
  } = deps;

  const menu = new Menu();
  const canViewSource = !!currentUrl
    && currentUrl !== 'about:blank'
    && !currentUrl.startsWith('devtools://')
    && !currentUrl.startsWith('view-source:');

  // Text editing actions
  if (params.isEditable) {
    menu.append(new MenuItem({ label: 'Undo', role: 'undo', enabled: params.editFlags.canUndo }));
    menu.append(new MenuItem({ label: 'Redo', role: 'redo', enabled: params.editFlags.canRedo }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Cut', role: 'cut', enabled: params.editFlags.canCut }));
    menu.append(new MenuItem({ label: 'Copy', role: 'copy', enabled: params.editFlags.canCopy }));
    menu.append(new MenuItem({ label: 'Paste', role: 'paste', enabled: params.editFlags.canPaste }));
    menu.append(new MenuItem({ label: 'Delete', role: 'delete', enabled: params.editFlags.canDelete }));
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({ label: 'Select All', role: 'selectAll', enabled: params.editFlags.canSelectAll }));
  } else {
    // Selection actions (non-editable)
    if (params.selectionText) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      menu.append(new MenuItem({ type: 'separator' }));
    }
    menu.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
  }

  // Link actions
  if (params.linkURL) {
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({
      label: 'Open Link in New Tab',
      click: () => openInNewTab(params.linkURL),
    }));
    menu.append(new MenuItem({
      label: 'Copy Link Address',
      click: () => copyText(params.linkURL),
    }));
  }

  // Image actions
  if (params.hasImageContents && params.srcURL) {
    menu.append(new MenuItem({ type: 'separator' }));
    menu.append(new MenuItem({
      label: 'Open Image in New Tab',
      click: () => openInNewTab(params.srcURL),
    }));
    menu.append(new MenuItem({
      label: 'Copy Image Address',
      click: () => copyText(params.srcURL),
    }));
  }

  // Page actions
  menu.append(new MenuItem({ type: 'separator' }));
  menu.append(new MenuItem({ label: 'Back', enabled: canGoBack, click: goBack }));
  menu.append(new MenuItem({ label: 'Forward', enabled: canGoForward, click: goForward }));
  menu.append(new MenuItem({ label: 'Reload', click: reload }));
  menu.append(new MenuItem({
    label: 'View Page Source',
    enabled: canViewSource,
    click: () => {
      if (canViewSource) {
        openPageSource(currentUrl);
      }
    },
  }));
  menu.append(new MenuItem({
    label: 'Inspect Element',
    click: () => inspectElement(params.x, params.y),
  }));

  return menu;
}
