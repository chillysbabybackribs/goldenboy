"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mergeDiscoverabilityArtifacts = mergeDiscoverabilityArtifacts;
exports.buildMergedDiscoverabilityReport = buildMergedDiscoverabilityReport;
const discoverabilityAuditRunner_1 = require("./discoverabilityAuditRunner");
function mergeDiscoverabilityArtifacts(payloads) {
    const merged = [];
    for (const payload of payloads) {
        for (const artifact of payload.artifacts || []) {
            merged.push(artifact);
        }
    }
    return merged;
}
function buildMergedDiscoverabilityReport(payloads) {
    return (0, discoverabilityAuditRunner_1.buildDiscoverabilityAuditReport)(mergeDiscoverabilityArtifacts(payloads));
}
//# sourceMappingURL=discoverabilityAggregate.js.map