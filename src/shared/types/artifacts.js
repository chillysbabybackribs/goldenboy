"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ARTIFACT_STATUSES = exports.ARTIFACT_FORMATS = void 0;
exports.isArtifactFormat = isArtifactFormat;
exports.isArtifactStatus = isArtifactStatus;
exports.ARTIFACT_FORMATS = ['md', 'txt', 'html', 'csv'];
exports.ARTIFACT_STATUSES = ['created', 'active', 'updating', 'failed', 'archived'];
function isArtifactFormat(value) {
    return exports.ARTIFACT_FORMATS.includes(value);
}
function isArtifactStatus(value) {
    return exports.ARTIFACT_STATUSES.includes(value);
}
//# sourceMappingURL=artifacts.js.map