"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.documentService = exports.DocumentService = void 0;
const ArtifactService_1 = require("../artifacts/ArtifactService");
const windowManager_1 = require("../windows/windowManager");
const document_1 = require("../../shared/types/document");
class DocumentService {
    listArtifacts() {
        return ArtifactService_1.artifactService.listArtifacts().map(document_1.toDocumentArtifactSummary);
    }
    getCurrentArtifactView() {
        const active = ArtifactService_1.artifactService.getActiveArtifact();
        if (!active)
            return null;
        return this.getArtifactView(active.id);
    }
    getArtifactView(artifactId) {
        const { artifact, content } = ArtifactService_1.artifactService.readContent(artifactId);
        return {
            artifact: (0, document_1.toDocumentArtifactSummary)(artifact),
            content,
        };
    }
    setCurrentArtifact(artifactId) {
        const artifact = ArtifactService_1.artifactService.setActiveArtifact(artifactId);
        return artifact ? this.getArtifactView(artifact.id) : null;
    }
    openArtifact(artifactId) {
        const view = this.setCurrentArtifact(artifactId);
        if (!view) {
            throw new Error(`Artifact not found: ${artifactId}`);
        }
        (0, windowManager_1.ensureWindow)('document', { showOnReady: true });
        (0, windowManager_1.focusWindow)('document', { maximize: true });
        return view;
    }
}
exports.DocumentService = DocumentService;
exports.documentService = new DocumentService();
//# sourceMappingURL=DocumentService.js.map