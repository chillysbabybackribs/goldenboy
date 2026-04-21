import { describe, expect, it, vi } from 'vitest';

import { BrowserLayoutService } from './BrowserLayoutService';

function createWindowMock() {
  return {
    isDestroyed: vi.fn(() => false),
    contentView: {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    },
  } as any;
}

function createViewMock() {
  return {
    setBounds: vi.fn(),
  } as any;
}

describe('BrowserLayoutService', () => {
  it('rehosts attached tab views onto the new host window', () => {
    const service = new BrowserLayoutService();
    const commandWindow = createWindowMock();
    const executionWindow = createWindowMock();
    const view = createViewMock();
    const tabs = new Map([['tab_1', { id: 'tab_1', view }]]);

    service.setHostWindow(commandWindow, 'command');
    service.setBounds({ x: 10, y: 20, width: 300, height: 200 }, 'command');
    service.applyLayout({
      tabs,
      activeTabId: 'tab_1',
      splitLeftTabId: null,
      splitRightTabId: null,
    });

    expect(commandWindow.contentView.addChildView).toHaveBeenCalledWith(view);
    expect(view.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 300, height: 200 });

    service.rehostWindow(executionWindow, 'execution', tabs);
    service.applyLayout({
      tabs,
      activeTabId: 'tab_1',
      splitLeftTabId: null,
      splitRightTabId: null,
    });

    expect(commandWindow.contentView.removeChildView).toHaveBeenCalledWith(view);
    expect(executionWindow.contentView.addChildView).toHaveBeenCalledWith(view);
    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 10, y: 20, width: 300, height: 200 });
  });

  it('applies cached bounds from the new host role after rehosting', () => {
    const service = new BrowserLayoutService();
    const commandWindow = createWindowMock();
    const executionWindow = createWindowMock();
    const view = createViewMock();
    const tabs = new Map([['tab_1', { id: 'tab_1', view }]]);

    service.setHostWindow(commandWindow, 'command');
    service.setBounds({ x: 4, y: 8, width: 320, height: 180 }, 'command');
    service.setBounds({ x: 40, y: 60, width: 640, height: 360 }, 'execution');
    service.applyLayout({
      tabs,
      activeTabId: 'tab_1',
      splitLeftTabId: null,
      splitRightTabId: null,
    });

    service.rehostWindow(executionWindow, 'execution', tabs);
    service.applyLayout({
      tabs,
      activeTabId: 'tab_1',
      splitLeftTabId: null,
      splitRightTabId: null,
    });

    expect(view.setBounds).toHaveBeenLastCalledWith({ x: 40, y: 60, width: 640, height: 360 });
    expect(executionWindow.contentView.addChildView).toHaveBeenCalledWith(view);
  });
});
