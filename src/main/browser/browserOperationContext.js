"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWithBrowserOperationContext = runWithBrowserOperationContext;
exports.getBrowserOperationContext = getBrowserOperationContext;
const node_async_hooks_1 = require("node:async_hooks");
const browserOperationContextStorage = new node_async_hooks_1.AsyncLocalStorage();
function runWithBrowserOperationContext(context, execute) {
    return browserOperationContextStorage.run(context, execute);
}
function getBrowserOperationContext() {
    return browserOperationContextStorage.getStore();
}
//# sourceMappingURL=browserOperationContext.js.map