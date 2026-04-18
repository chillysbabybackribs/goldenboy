"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerArtifactIpc = registerArtifactIpc;
const ipc_1 = require("../../shared/types/ipc");
const ArtifactService_1 = require("../artifacts/ArtifactService");
function registerArtifactIpc(safeHandle) {
    safeHandle(ipc_1.IPC_CHANNELS.ARTIFACT_CREATE, (_event, input) => {
        return ArtifactService_1.artifactService.createArtifact(input);
    });
    safeHandle(ipc_1.IPC_CHANNELS.ARTIFACT_GET, (_event, artifactId) => {
        return ArtifactService_1.artifactService.getArtifact(artifactId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.ARTIFACT_LIST, () => {
        return ArtifactService_1.artifactService.listArtifacts();
    });
    safeHandle(ipc_1.IPC_CHANNELS.ARTIFACT_SET_ACTIVE, (_event, artifactId) => {
        return ArtifactService_1.artifactService.setActiveArtifact(artifactId);
    });
    safeHandle(ipc_1.IPC_CHANNELS.ARTIFACT_GET_ACTIVE, () => {
        return ArtifactService_1.artifactService.getActiveArtifact();
    });
    safeHandle(ipc_1.IPC_CHANNELS.ARTIFACT_DELETE, (_event, input) => {
        if (typeof input?.artifactId !== 'string' || !input.artifactId.trim()) {
            throw new Error('artifact.delete requires a valid artifact id.');
        }
        return ArtifactService_1.artifactService.deleteArtifact(input.artifactId, input.deletedBy);
    });
    safeHandle(ipc_1.IPC_CHANNELS.ARTIFACT_REPLACE_CONTENT, (_event, input) => {
        if (typeof input?.content !== 'string') {
            throw new Error('Artifact replaceContent requires string content.');
        }
        return input?.artifactId
            ? ArtifactService_1.artifactService.replaceContent(input.artifactId, input.content, input.updatedBy)
            : ArtifactService_1.artifactService.replaceActiveArtifactContent(input.content, input.updatedBy);
    });
    safeHandle(ipc_1.IPC_CHANNELS.ARTIFACT_APPEND_CONTENT, (_event, input) => {
        if (typeof input?.content !== 'string') {
            throw new Error('Artifact appendContent requires string content.');
        }
        return input?.artifactId
            ? ArtifactService_1.artifactService.appendContent(input.artifactId, input.content, input.updatedBy)
            : ArtifactService_1.artifactService.appendActiveArtifactContent(input.content, input.updatedBy);
    });
}
//# sourceMappingURL=registerArtifactIpc.js.map