"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const artifactRouting_1 = require("./artifactRouting");
function activeArtifact(overrides) {
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
(0, vitest_1.describe)('artifact routing', () => {
    (0, vitest_1.it)('defaults ambiguous follow-up artifact prompts to updating the active artifact', () => {
        const decision = (0, artifactRouting_1.buildArtifactRoutingDecision)('Continue this report with a tighter executive summary.', activeArtifact());
        (0, vitest_1.expect)(decision).toEqual(vitest_1.expect.objectContaining({
            action: 'update',
            mutation: 'replace',
            targetArtifactTitle: 'Weekly Research Note',
        }));
    });
    (0, vitest_1.it)('routes csv tracking prompts to append', () => {
        const decision = (0, artifactRouting_1.buildArtifactRoutingDecision)('Append 2 more rows to this tracking sheet.', activeArtifact({ format: 'csv', title: 'Competitor Tracker' }));
        (0, vitest_1.expect)(decision).toEqual(vitest_1.expect.objectContaining({
            action: 'update',
            mutation: 'append',
            targetArtifactFormat: 'csv',
        }));
    });
    (0, vitest_1.it)('routes delete prompts to deleting the active artifact', () => {
        const decision = (0, artifactRouting_1.buildArtifactRoutingDecision)('Delete this document.', activeArtifact());
        (0, vitest_1.expect)(decision).toEqual(vitest_1.expect.objectContaining({
            action: 'delete',
            mutation: 'delete',
            targetArtifactTitle: 'Weekly Research Note',
        }));
    });
    (0, vitest_1.it)('creates a new artifact when explicitly requested', () => {
        const decision = (0, artifactRouting_1.buildArtifactRoutingDecision)('Create new markdown artifact called Launch Brief.', activeArtifact());
        (0, vitest_1.expect)(decision).toEqual(vitest_1.expect.objectContaining({
            action: 'create',
            mutation: 'replace',
        }));
    });
    (0, vitest_1.it)('creates when no active artifact exists', () => {
        const decision = (0, artifactRouting_1.buildArtifactRoutingDecision)('Update this document with a new summary.', null);
        (0, vitest_1.expect)(decision).toEqual(vitest_1.expect.objectContaining({
            action: 'create',
            mutation: 'replace',
        }));
    });
    (0, vitest_1.it)('marks append-to-html as invalid', () => {
        const decision = (0, artifactRouting_1.buildArtifactRoutingDecision)('Append a footer to this html document.', activeArtifact({ format: 'html', title: 'Landing Page' }));
        (0, vitest_1.expect)(decision?.invalidReason).toContain('Append is not supported for html artifacts');
    });
    (0, vitest_1.it)('filters filesystem write tools for artifact-routed runs', () => {
        const decision = (0, artifactRouting_1.buildArtifactRoutingDecision)('Update this document with a tighter version.', activeArtifact());
        (0, vitest_1.expect)((0, artifactRouting_1.withArtifactRoutingAllowedTools)(['filesystem.read', 'filesystem.write', 'filesystem.patch', 'filesystem.delete', 'terminal.exec'], decision)).toEqual(vitest_1.expect.arrayContaining([
            'artifact.create',
            'artifact.delete',
            'artifact.replace_content',
            'artifact.append_content',
            'filesystem.read',
            'terminal.exec',
        ]));
        (0, vitest_1.expect)((0, artifactRouting_1.withArtifactRoutingAllowedTools)(['filesystem.read', 'filesystem.write', 'filesystem.patch', 'filesystem.delete', 'terminal.exec'], decision)).not.toEqual(vitest_1.expect.arrayContaining(['filesystem.write', 'filesystem.patch', 'filesystem.delete']));
    });
    (0, vitest_1.it)('builds explicit routing instructions with artifact feedback requirements', () => {
        const instructions = (0, artifactRouting_1.buildArtifactRoutingInstructions)((0, artifactRouting_1.buildArtifactRoutingDecision)('Update this document with a tighter version.', activeArtifact()));
        (0, vitest_1.expect)(instructions).toContain('Deterministic route: UPDATE using REPLACE.');
        (0, vitest_1.expect)(instructions).toContain('After the tool call, explicitly name the artifact');
    });
    (0, vitest_1.it)('does not misclassify unrelated code-update prompts as artifact work', () => {
        (0, vitest_1.expect)((0, artifactRouting_1.buildArtifactRoutingDecision)('Update the auth middleware to validate JWT expiry correctly.', activeArtifact())).toBeNull();
    });
});
//# sourceMappingURL=artifactRouting.test.js.map