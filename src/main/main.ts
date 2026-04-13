import { app, BrowserWindow } from 'electron';
import { registerIpc } from './ipc/registerIpc';
import { initEventRouter } from './events/eventRouter';
import { createAllWindows, applyDefaultBounds, setAppQuitting, showAllWindows } from './windows/windowManager';
import { appStateStore } from './state/appStateStore';
import { terminalService } from './terminal/TerminalService';
import { browserService } from './browser/BrowserService';
import { agentModelService } from './agent/AgentModelService';

const disableGpu = process.env.V2_DISABLE_HARDWARE_ACCELERATION === '1';
if (disableGpu) {
  process.env.ELECTRON_DISABLE_GPU = '1';
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showAllWindows();
  });
}

app.on('ready', () => {
  app.on('web-contents-created', (_event, webContents) => {
    webContents.on('will-attach-webview', (event, webPreferences, params) => {
      webPreferences.preload = '';
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
      webPreferences.webSecurity = true;
      if (params?.src && params.src.startsWith('file://')) {
        event.preventDefault();
      }
    });
  });

  terminalService.init();
  agentModelService.init();
  registerIpc();
  initEventRouter();
  createAllWindows();
  applyDefaultBounds();
});

app.on('before-quit', () => {
  setAppQuitting();
  terminalService.setAppQuitting();
  terminalService.persistNow();
  browserService.dispose();
  terminalService.dispose();
  appStateStore.persistNow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createAllWindows();
    applyDefaultBounds();
  } else {
    showAllWindows();
  }
});
