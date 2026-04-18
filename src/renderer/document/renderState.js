"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDocumentRenderCheckpoint = getDocumentRenderCheckpoint;
exports.shouldRefreshDocumentView = shouldRefreshDocumentView;
function getDocumentRenderCheckpoint(state) {
    const artifactId = state?.activeArtifactId ?? null;
    if (!artifactId) {
        return { artifactId: null, updatedAt: null };
    }
    const artifact = state?.artifacts.find((entry) => entry.id === artifactId);
    return {
        artifactId,
        updatedAt: artifact?.updatedAt ?? null,
    };
}
function shouldRefreshDocumentView(previous, next) {
    if (!previous)
        return true;
    return previous.artifactId !== next.artifactId || previous.updatedAt !== next.updatedAt;
}
//# sourceMappingURL=renderState.js.map