import { describe, expect, it } from 'vitest';
import type { ArtifactRecord } from '../../shared/types/artifacts';
import {
  buildArtifactRoutingDecision,
  buildArtifactRoutingInstructions,
  withArtifactRoutingAllowedTools,
} from './artifactRouting';

function activeArtifact(overrides?: Partial<ArtifactRecord>): ArtifactRecord {
  return {
    id: 'artifact-1',
    title: 'Weekly Research Note',
    format: 'md',
    workingPath: '/tmp/weekly-research-note.md',
    createdBy: 'user',
    lastUpdatedBy: 'user',
    createdAt: 1,
    updatedAt: 10,
    status: 'active',
    linkedTaskIds: [],
    previewable: true,
    exportable: true,
    archived: false,
    ...overrides,
  };
}

describe('artifact routing', () => {
  it('defaults ambiguous follow-up artifact prompts to updating the active artifact', () => {
    const decision = buildArtifactRoutingDecision(
      'Continue this report with a tighter executive summary.',
      activeArtifact(),
    );

    expect(decision).toEqual(expect.objectContaining({
      action: 'update',
      mutation: 'replace',
      targetArtifactTitle: 'Weekly Research Note',
    }));
  });

  it('routes csv tracking prompts to append', () => {
    const decision = buildArtifactRoutingDecision(
      'Append 2 more rows to this tracking sheet.',
      activeArtifact({ format: 'csv', title: 'Competitor Tracker' }),
    );

    expect(decision).toEqual(expect.objectContaining({
      action: 'update',
      mutation: 'append',
      targetArtifactFormat: 'csv',
    }));
  });

  it('routes delete prompts to deleting the active artifact', () => {
    const decision = buildArtifactRoutingDecision(
      'Delete this document.',
      activeArtifact(),
    );

    expect(decision).toEqual(expect.objectContaining({
      action: 'delete',
      mutation: 'delete',
      targetArtifactTitle: 'Weekly Research Note',
    }));
  });

  it('creates a new artifact when explicitly requested', () => {
    const decision = buildArtifactRoutingDecision(
      'Create new markdown artifact called Launch Brief.',
      activeArtifact(),
    );

    expect(decision).toEqual(expect.objectContaining({
      action: 'create',
      mutation: 'replace',
    }));
  });

  it('creates when no active artifact exists', () => {
    const decision = buildArtifactRoutingDecision('Update this document with a new summary.', null);

    expect(decision).toEqual(expect.objectContaining({
      action: 'create',
      mutation: 'replace',
    }));
  });

  it('marks append-to-html as invalid', () => {
    const decision = buildArtifactRoutingDecision(
      'Append a footer to this html document.',
      activeArtifact({ format: 'html', title: 'Landing Page' }),
    );

    expect(decision?.invalidReason).toContain('Append is not supported for html artifacts');
  });

  it('filters filesystem write tools for artifact-routed runs', () => {
    const decision = buildArtifactRoutingDecision(
      'Update this document with a tighter version.',
      activeArtifact(),
    );

    expect(withArtifactRoutingAllowedTools(
      ['filesystem.read', 'filesystem.write', 'filesystem.patch', 'filesystem.delete', 'terminal.exec'],
      decision,
    )).toEqual(expect.arrayContaining([
      'artifact.create',
      'artifact.delete',
      'artifact.replace_content',
      'artifact.append_content',
      'filesystem.read',
      'terminal.exec',
    ]));
    expect(withArtifactRoutingAllowedTools(
      ['filesystem.read', 'filesystem.write', 'filesystem.patch', 'filesystem.delete', 'terminal.exec'],
      decision,
    )).not.toEqual(expect.arrayContaining(['filesystem.write', 'filesystem.patch', 'filesystem.delete']));
  });

  it('builds explicit routing instructions with artifact feedback requirements', () => {
    const instructions = buildArtifactRoutingInstructions(buildArtifactRoutingDecision(
      'Update this document with a tighter version.',
      activeArtifact(),
    ));

    expect(instructions).toContain('Deterministic route: UPDATE using REPLACE.');
    expect(instructions).toContain('After the tool call, explicitly name the artifact');
  });

  it('does not misclassify unrelated code-update prompts as artifact work', () => {
    expect(buildArtifactRoutingDecision(
      'Update the auth middleware to validate JWT expiry correctly.',
      activeArtifact(),
    )).toBeNull();
  });
});
