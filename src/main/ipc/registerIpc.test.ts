import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/types/ipc';

const { handleMock, onMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  onMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
    on: onMock,
  },
}));

vi.mock('../state/appStateStore', () => ({
  appStateStore: {
    getState: vi.fn(() => ({ tasks: [] })),
    dispatch: vi.fn(),
  },
}));

vi.mock('../events/eventBus', () => ({
  eventBus: {
    emit: vi.fn(),
  },
}));

vi.mock('../windows/windowManager', () => ({
  getRoleByWebContentsId: vi.fn(() => 'command'),
  getWindowByRole: vi.fn(() => null),
}));

vi.mock('../terminal/TerminalService', () => ({
  terminalService: {},
}));

vi.mock('../browser/BrowserService', () => ({
  browserService: {
    isKnownTabWebContents: vi.fn(() => false),
  },
}));

vi.mock('../browser/browserOperationLedger', () => ({
  getRecentBrowserOperationLedgerEntries: vi.fn(() => []),
}));

vi.mock('../actions/SurfaceActionRouter', () => ({
  surfaceActionRouter: {},
}));

vi.mock('../context/diskCache', () => ({
  DiskCache: vi.fn(),
}));

vi.mock('../context/pageExtractor', () => ({
  PageExtractor: vi.fn(),
}));

vi.mock('../agent/AgentModelService', () => ({
  agentModelService: {
    resolve: vi.fn(() => 'gpt-5.4'),
  },
}));

vi.mock('../agent/AgentToolExecutor', () => ({
  agentToolExecutor: {
    execute: vi.fn(),
  },
}));

vi.mock('../attachments/DocumentAttachmentStore', () => ({
  documentAttachmentStore: {},
}));

vi.mock('../models/taskMemoryStore', () => ({
  taskMemoryStore: {},
}));

vi.mock('../../shared/utils/ids', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}-1`),
}));

import { registerIpc } from './registerIpc';

describe('registerIpc', () => {
  beforeEach(() => {
    handleMock.mockReset();
    onMock.mockReset();
  });

  it('disables renderer tool invocation through TOOL_INVOKE', async () => {
    registerIpc();

    const toolInvoke = handleMock.mock.calls.find(([channel]) => channel === IPC_CHANNELS.TOOL_INVOKE);
    expect(toolInvoke).toBeTruthy();

    const handler = toolInvoke?.[1] as (event: { sender: { id: number } }) => Promise<unknown>;

    await expect(handler({ sender: { id: 1 } })).rejects.toThrow(
      'Renderer tool invocation is disabled. Use the provider tool runtime.',
    );
  });
});
