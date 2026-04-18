"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const BrowserInstrumentation_1 = require("./BrowserInstrumentation");
(0, vitest_1.describe)('BrowserInstrumentation', () => {
    let instrumentation;
    let listeners;
    (0, vitest_1.beforeEach)(() => {
        listeners = {};
        instrumentation = new BrowserInstrumentation_1.BrowserInstrumentation('ctx_default');
        instrumentation.attachSession({
            webRequest: {
                onBeforeRequest: vitest_1.vi.fn((listener) => {
                    listeners.beforeRequest = listener;
                }),
                onBeforeSendHeaders: vitest_1.vi.fn((listener) => {
                    listeners.beforeSendHeaders = listener;
                }),
                onHeadersReceived: vitest_1.vi.fn((listener) => {
                    listeners.headersReceived = listener;
                }),
                onBeforeRedirect: vitest_1.vi.fn((listener) => {
                    listeners.beforeRedirect = listener;
                }),
                onCompleted: vitest_1.vi.fn((listener) => {
                    listeners.completed = listener;
                }),
                onErrorOccurred: vitest_1.vi.fn((listener) => {
                    listeners.errorOccurred = listener;
                }),
            },
        });
        instrumentation.attachTab('tab_1', {
            id: 101,
            on: vitest_1.vi.fn(),
        });
    });
    (0, vitest_1.it)('captures rich network metadata and operation linkage in a bounded record', () => {
        instrumentation.beginOperationNetworkScope({
            operationId: 'op_1',
            contextId: 'ctx_default',
            kind: 'browser.navigate',
            tabId: 'tab_1',
        });
        const beforeRequestCallback = vitest_1.vi.fn();
        listeners.beforeRequest?.({
            id: 1,
            webContentsId: 101,
            method: 'POST',
            url: 'https://api.example.com/data',
            resourceType: 'xhr',
            uploadData: [{ bytes: Buffer.from('hello') }],
        }, beforeRequestCallback);
        (0, vitest_1.expect)(beforeRequestCallback).toHaveBeenCalledWith({ cancel: false });
        const beforeSendHeadersCallback = vitest_1.vi.fn();
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
        const headersReceivedCallback = vitest_1.vi.fn();
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
        (0, vitest_1.expect)(events).toHaveLength(1);
        (0, vitest_1.expect)(events[0]).toEqual(vitest_1.expect.objectContaining({
            requestId: '1',
            contextId: 'ctx_default',
            operationId: 'op_1',
            tabId: 'tab_1',
            method: 'POST',
            url: 'https://api.example.com/data',
            statusCode: 201,
            requestBodySize: 5,
            requestHeaders: vitest_1.expect.objectContaining({
                'Content-Type': 'application/json',
                Authorization: '[redacted]',
            }),
            responseHeaders: vitest_1.expect.objectContaining({
                'content-type': 'application/json',
                'set-cookie': '[redacted]',
            }),
        }));
        const capture = instrumentation.completeOperationNetworkScope('op_1');
        (0, vitest_1.expect)(capture).toEqual({
            eventIds: [events[0].id],
            summary: {
                requestCount: 1,
                failedRequestCount: 0,
                urls: ['https://api.example.com/data'],
                statusCodes: [201],
            },
        });
    });
    (0, vitest_1.it)('applies registered interception policies through the central before-send-headers hook', () => {
        instrumentation.registerNetworkInterceptionPolicy({
            id: 'add-test-header',
            matches: ({ url }) => url.includes('example.com'),
            onBeforeSendHeaders: () => ({
                requestHeaders: {
                    'X-Test-Policy': 'enabled',
                },
            }),
        });
        const callback = vitest_1.vi.fn();
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
        (0, vitest_1.expect)(callback).toHaveBeenCalledWith(vitest_1.expect.objectContaining({
            cancel: false,
            requestHeaders: vitest_1.expect.objectContaining({
                Accept: 'text/html',
                'X-Test-Policy': 'enabled',
            }),
        }));
    });
});
//# sourceMappingURL=BrowserInstrumentation.test.js.map