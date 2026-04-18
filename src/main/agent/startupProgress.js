"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildStartupStatusMessages = buildStartupStatusMessages;
exports.resolveExecutionBackendLabel = resolveExecutionBackendLabel;
const model_1 = require("../../shared/types/model");
function buildStartupStatusMessages(input) {
    void input;
    return [];
}
function resolveExecutionBackendLabel(providerId) {
    if (providerId === model_1.PRIMARY_PROVIDER_ID)
        return 'app-server';
    if (providerId === model_1.HAIKU_PROVIDER_ID)
        return 'anthropic-api';
    return 'runtime';
}
//# sourceMappingURL=startupProgress.js.map