"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toDocumentArtifactSummary = toDocumentArtifactSummary;
function toDocumentArtifactSummary(artifact) {
    return {
        id: artifact.id,
        title: artifact.title,
        format: artifact.format,
        createdAt: artifact.createdAt,
        createdBy: artifact.createdBy,
        updatedAt: artifact.updatedAt,
        lastUpdatedBy: artifact.lastUpdatedBy,
        status: artifact.status,
        linkedTaskIds: [...artifact.linkedTaskIds],
        previewable: artifact.previewable,
        exportable: artifact.exportable,
        archived: artifact.archived,
    };
}
//# sourceMappingURL=document.js.map