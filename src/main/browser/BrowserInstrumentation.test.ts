import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BrowserInstrumentation } from './BrowserInstrumentation';

type WebRequestListeners = {
  beforeRequest?: (details: any, callback: (response: any) => void) => void;
  beforeSendHeaders?: (details: any, callback: (response: any) => void) => void;
  headersReceived?: (details: any, callback: (response: any) => void) => void;
  beforeRedirect?: (details: any) => void;
  completed?: (details: any) => void;
  errorOccurred?: (details: any) => void;
};

describe('BrowserInstrumentation', () => {
  let instrumentation: BrowserInstrumentation;
  let listeners: WebRequestListeners;

  beforeEach(() => {
    listeners = {};
    instrumentation = new BrowserInstrumentation('ctx_default');
    instrumentation.attachSession({
      webRequest: {
        onBeforeRequest: vi.fn((listener: WebRequestListeners['beforeRequest']) => {
          listeners.beforeRequest = listener;
        }),
        onBeforeSendHeaders: vi.fn((listener: WebRequestListeners['beforeSendHeaders']) => {
          listeners.beforeSendHeaders = listener;
        }),
        onHeadersReceived: vi.fn((listener: WebRequestListeners['headersReceived']) => {
          listeners.headersReceived = listener;
        }),
        onBeforeRedirect: vi.fn((listener: WebRequestListeners['beforeRedirect']) => {
          listeners.beforeRedirect = listener;
        }),
        onCompleted: vi.fn((listener: WebRequestListeners['completed']) => {
          listeners.completed = listener;
        }),
        onErrorOccurred: vi.fn((listener: WebRequestListeners['errorOccurred']) => {
          listeners.errorOccurred = listener;
        }),
      },
    } as any);
    instrumentation.attachTab('tab_1', {
      id: 101,
      on: vi.fn(),
    } as any);
  });

  it('captures rich network metadata and operation linkage in a bounded record', () => {
    instrumentation.beginOperationNetworkScope({
      operationId: 'op_1',
      contextId: 'ctx_default',
      kind: 'browser.navigate',
      tabId: 'tab_1',
    });

    const beforeRequestCallback = vi.fn();
    listeners.beforeRequest?.({
      id: 1,
      webContentsId: 101,
      method: 'POST',
      url: 'https://api.example.com/data',
      resourceType: 'xhr',
      uploadData: [{ bytes: Buffer.from('hello') }],
    }, beforeRequestCallback);
    expect(beforeRequestCallback).toHaveBeenCalledWith({ cancel: false });

    const beforeSendHeadersCallback = vi.fn();
    listeners.beforeSendHeaders?.({
      id: 1,
      webContentsId: 101,
      method: 'POST',
      url: 'https://api.example.com/data',
      resourceType: 'xhr',
      requestHeaders: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
      },
    }, beforeSendHeadersCallback);

    const headersReceivedCallback = vi.fn();
    listeners.headersReceived?.({
      id: 1,
      webContentsId: 101,
      method: 'POST',
      url: 'https://api.example.com/data',
      resourceType: 'xhr',
      statusCode: 201,
      responseHeaders: {
        'content-type': ['application/json'],
        'set-cookie': ['session=secret'],
      },
    }, headersReceivedCallback);

    listeners.completed?.({
      id: 1,
      webContentsId: 101,
      method: 'POST',
      url: 'https://api.example.com/data',
      resourceType: 'xhr',
      statusCode: 201,
      fromCache: false,
      encodedDataLength: 128,
    });

    const events = instrumentation.getNetworkEvents('tab_1');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(expect.objectContaining({
      requestId: '1',
      contextId: 'ctx_default',
      operationId: 'op_1',
      tabId: 'tab_1',
      method: 'POST',
      url: 'https://api.example.com/data',
      statusCode: 201,
      requestBodySize: 5,
      requestHeaders: expect.objectContaining({
        'Content-Type': 'application/json',
        Authorization: '[redacted]',
      }),
      responseHeaders: expect.objectContaining({
        'content-type': 'application/json',
        'set-cookie': '[redacted]',
      }),
    }));

    const capture = instrumentation.completeOperationNetworkScope('op_1');
    expect(capture).toEqual({
      eventIds: [events[0].id],
      summary: {
        requestCount: 1,
        failedRequestCount: 0,
        urls: ['https://api.example.com/data'],
        statusCodes: [201],
      },
    });
  });

  it('applies registered interception policies through the central before-send-headers hook', () => {
    instrumentation.registerNetworkInterceptionPolicy({
      id: 'add-test-header',
      matches: ({ url }) => url.includes('example.com'),
      onBeforeSendHeaders: () => ({
        requestHeaders: {
          'X-Test-Policy': 'enabled',
        },
      }),
    });

    const callback = vi.fn();
    listeners.beforeSendHeaders?.({
      id: 2,
      webContentsId: 101,
      method: 'GET',
      url: 'https://example.com/',
      resourceType: 'mainFrame',
      requestHeaders: {
        Accept: 'text/html',
      },
    }, callback);

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      cancel: false,
      requestHeaders: expect.objectContaining({
        Accept: 'text/html',
        'X-Test-Policy': 'enabled',
      }),
    }));
  });
});
