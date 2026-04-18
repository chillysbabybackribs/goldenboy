"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerDocumentIpc = registerDocumentIpc;
const ipc_1 = require("../../shared/types/ipc");
const DocumentService_1 = require("../document/DocumentService");
function registerDocumentIpc(safeHandle) {
    safeHandle(ipc_1.IPC_CHANNELS.DOCUMENT_OPEN_ARTIFACT, (_event, artifactId) => {
        if (typeof artifactId !== 'string' || !artifactId.trim()) {
            throw new Error('document.openArtifact requires a valid artifact id.');
        }
        return DocumentService_1.documentService.openArtifact(artifactId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.DOCUMENT_GET_CURRENT, () => {
        return DocumentService_1.documentService.getCurrentArtifactView();
    });
    safeHandle(ipc_1.IPC_CHANNELS.DOCUMENT_GET_ARTIFACT, (_event, artifactId) => {
        if (typeof artifactId !== 'string' || !artifactId.trim()) {
            throw new Error('document.getArtifact requires a valid artifact id.');
        }
        return DocumentService_1.documentService.getArtifactView(artifactId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.DOCUMENT_LIST_ARTIFACTS, () => {
        return DocumentService_1.documentService.listArtifacts();
    });
    safeHandle(ipc_1.IPC_CHANNELS.DOCUMENT_SET_CURRENT, (_event, artifactId) => {
        if (artifactId !== null && (typeof artifactId !== 'string' || !artifactId.trim())) {
            throw new Error('document.setCurrent requires a valid artifact id or null.');
        }
        return DocumentService_1.documentService.setCurrentArtifact(artifactId);
    });
}
//# sourceMappingURL=registerDocumentIpc.js.map