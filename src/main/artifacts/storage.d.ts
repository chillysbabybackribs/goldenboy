import type { ArtifactFormat } from '../../shared/types/artifacts';
export declare function getArtifactsRoot(): string;
export declare function ensureArtifactsRoot(): string;
export declare function getArtifactDirectory(artifactId: string): string;
export declare function ensureArtifactDirectory(artifactId: string): string;
export declare function buildArtifactFilename(title: string, format: ArtifactFormat): string;
export declare function buildArtifactWorkingPath(input: {
    artifactId: string;
    title: string;
    format: ArtifactFormat;
}): string;
export declare function ensureArtifactWorkingFile(input: {
    artifactId: string;
    title: string;
    format: ArtifactFormat;
}): string;
export declare function isPathInArtifactsRoot(targetPath: string): boolean;
export declare function isPathInArtifactDirectory(artifactId: string, targetPath: string): boolean;
