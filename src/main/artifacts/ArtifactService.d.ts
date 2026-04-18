import { ArtifactActor, ArtifactMetadataPatch, ArtifactRecord, CreateArtifactInput } from '../../shared/types/artifacts';
export declare class ArtifactService {
    constructor();
    createArtifact(input: CreateArtifactInput): ArtifactRecord;
    getArtifact(id: string): ArtifactRecord | null;
    listArtifacts(): ArtifactRecord[];
    updateArtifactMetadata(id: string, patch: ArtifactMetadataPatch): ArtifactRecord;
    linkArtifactToTask(artifactId: string, taskId: string): ArtifactRecord;
    setActiveArtifact(artifactId: string | null): ArtifactRecord | null;
    getActiveArtifact(): ArtifactRecord | null;
    deleteArtifact(artifactId: string, _deletedBy?: ArtifactActor): {
        deletedArtifactId: string;
        nextActiveArtifact: ArtifactRecord | null;
    };
    readContent(artifactId: string): {
        artifact: ArtifactRecord;
        content: string;
    };
    readActiveArtifactContent(): {
        artifact: ArtifactRecord;
        content: string;
    };
    replaceContent(artifactId: string, content: string, updatedBy?: ArtifactActor): ArtifactRecord;
    appendContent(artifactId: string, content: string, updatedBy?: ArtifactActor): ArtifactRecord;
    replaceActiveArtifactContent(content: string, updatedBy?: ArtifactActor): ArtifactRecord;
    appendActiveArtifactContent(content: string, updatedBy?: ArtifactActor): ArtifactRecord;
    private requireWritableArtifact;
    private resolveUpdatedBy;
    private beginWrite;
    private finishWrite;
    private failWrite;
    private linkArtifactIfTaskActor;
}
export declare const artifactService: ArtifactService;
