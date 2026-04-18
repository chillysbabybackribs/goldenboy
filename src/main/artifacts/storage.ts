import * as fs from 'fs';
import * as path from 'path';
import type { ArtifactFormat } from '../../shared/types/artifacts';
import { APP_WORKSPACE_ROOT } from '../workspaceRoot';

const ARTIFACTS_DIR = 'artifacts';

function sanitizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function getArtifactsRoot(): string {
  return path.join(APP_WORKSPACE_ROOT, ARTIFACTS_DIR);
}

export function ensureArtifactsRoot(): string {
  const root = getArtifactsRoot();
  fs.mkdirSync(root, { recursive: true });
  return root;
}

export function getArtifactDirectory(artifactId: string): string {
  return path.join(getArtifactsRoot(), artifactId);
}

export function ensureArtifactDirectory(artifactId: string): string {
  const dir = getArtifactDirectory(artifactId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function buildArtifactFilename(title: string, format: ArtifactFormat): string {
  const base = sanitizeSegment(title) || 'untitled';
  return `${base}.${format}`;
}

export function buildArtifactWorkingPath(input: {
  artifactId: string;
  title: string;
  format: ArtifactFormat;
}): string {
  return path.join(
    getArtifactDirectory(input.artifactId),
    buildArtifactFilename(input.title, input.format),
  );
}

export function ensureArtifactWorkingFile(input: {
  artifactId: string;
  title: string;
  format: ArtifactFormat;
}): string {
  const dir = ensureArtifactDirectory(input.artifactId);
  const workingPath = path.join(dir, buildArtifactFilename(input.title, input.format));
  if (!fs.existsSync(workingPath)) {
    fs.writeFileSync(workingPath, '', 'utf-8');
  }
  return workingPath;
}

export function isPathInArtifactsRoot(targetPath: string): boolean {
  const relative = path.relative(getArtifactsRoot(), targetPath);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export function isPathInArtifactDirectory(artifactId: string, targetPath: string): boolean {
  const relative = path.relative(getArtifactDirectory(artifactId), path.resolve(targetPath));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}
