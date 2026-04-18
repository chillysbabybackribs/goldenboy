import type { ArtifactFormat, ArtifactRecord, ArtifactStatus } from '../../shared/types/artifacts';
import type { AgentToolName } from './AgentTypes';

export type ArtifactRoutingMutation = 'replace' | 'append' | 'delete';
export type ArtifactRoutingAction = 'create' | 'update' | 'delete';

export type ArtifactRoutingDecision = {
  applies: boolean;
  action: ArtifactRoutingAction;
  mutation: ArtifactRoutingMutation;
  reason: string;
  targetArtifactId: string | null;
  targetArtifactTitle: string | null;
  targetArtifactFormat: ArtifactFormat | null;
  targetArtifactStatus: ArtifactStatus | null;
  invalidReason: string | null;
};

const ARTIFACT_ROUTE_TOOL_NAMES: AgentToolName[] = [
  'artifact.list',
  'artifact.get',
  'artifact.get_active',
  'artifact.read',
  'artifact.create',
  'artifact.delete',
  'artifact.replace_content',
  'artifact.append_content',
];

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase();
}

function looksLikeCodeOrRepoPrompt(normalized: string): boolean {
  return /\b(file|files|code|repo|repository|middleware|function|component|class|api|endpoint|terminal|test|build|schema|database|query|auth|jwt)\b/.test(normalized);
}

function looksLikeArtifactPrompt(normalized: string, hasActiveArtifact: boolean): boolean {
  if (looksLikeCodeOrRepoPrompt(normalized)) return false;
  if (/\bartifact\b/.test(normalized)) return true;
  if (/\b(markdown|md|html|txt|csv|document|note|report|sheet|table|tracking sheet|tracking table)\b/.test(normalized)) return true;
  if (hasActiveArtifact && /\b(this|current|active|that)\s+(artifact|document|note|report|sheet|table)\b/.test(normalized)) return true;
  return hasActiveArtifact
    && normalized.length <= 80
    && /^(update|revise|continue|append|add|add to|rewrite|regenerate|log|track)\b/.test(normalized);
}

function wantsExplicitNew(normalized: string): boolean {
  return /\b(create new|make a new|start a new|new artifact|new document|new note|new report|new sheet|new table)\b/.test(normalized);
}

function wantsUpdate(normalized: string): boolean {
  return /\b(update|revise|continue|add to|append|rewrite|regenerate|rework|keep working on|continue with)\b/.test(normalized);
}

function wantsDelete(normalized: string): boolean {
  return /\b(delete|remove|discard|trash)\b/.test(normalized);
}

function wantsAppend(normalized: string): boolean {
  return /\b(append|add|add to|log|track)\b/.test(normalized);
}

function wantsReplace(normalized: string): boolean {
  return /\b(rewrite|update|revise|regenerate|replace|rework)\b/.test(normalized);
}

function isCsvAdditive(normalized: string, activeArtifact: ArtifactRecord | null): boolean {
  return activeArtifact?.format === 'csv' && /\b(add|append|log|track|rows?|entries?)\b/.test(normalized);
}

export function buildArtifactRoutingDecision(
  prompt: string,
  activeArtifact: ArtifactRecord | null,
): ArtifactRoutingDecision | null {
  const normalized = normalizePrompt(prompt);
  const hasActiveArtifact = Boolean(activeArtifact);
  if (!looksLikeArtifactPrompt(normalized, hasActiveArtifact)) {
    return null;
  }

  let action: ArtifactRoutingAction;
  let reason: string;

  if (wantsExplicitNew(normalized)) {
    action = 'create';
    reason = 'prompt explicitly asks for a new artifact';
  } else if (!activeArtifact) {
    action = 'create';
    reason = 'no active artifact exists';
  } else if (wantsDelete(normalized)) {
    action = 'delete';
    reason = 'prompt explicitly asks to delete the current artifact';
  } else if (wantsUpdate(normalized)) {
    action = 'update';
    reason = 'prompt asks to continue or revise existing work';
  } else {
    action = 'update';
    reason = 'active artifact exists and ambiguous artifact requests default to update';
  }

  let mutation: ArtifactRoutingMutation = 'replace';
  if (action === 'delete') {
    mutation = 'delete';
  } else if (wantsAppend(normalized) || isCsvAdditive(normalized, activeArtifact)) {
    mutation = 'append';
  } else if (wantsReplace(normalized)) {
    mutation = 'replace';
  }

  let invalidReason: string | null = null;
  if (action === 'update' && activeArtifact?.archived) {
    invalidReason = `The active artifact "${activeArtifact.title}" is archived and must not be updated.`;
  } else if (action === 'update' && mutation === 'append' && activeArtifact?.format === 'html') {
    invalidReason = `Append is not supported for html artifacts like "${activeArtifact.title}".`;
  }

  return {
    applies: true,
    action,
    mutation,
    reason,
    targetArtifactId: action === 'update' || action === 'delete' ? activeArtifact?.id ?? null : null,
    targetArtifactTitle: action === 'update' || action === 'delete' ? activeArtifact?.title ?? null : null,
    targetArtifactFormat: action === 'update' || action === 'delete' ? activeArtifact?.format ?? null : null,
    targetArtifactStatus: action === 'update' || action === 'delete' ? activeArtifact?.status ?? null : null,
    invalidReason,
  };
}

export function buildArtifactRoutingInstructions(decision: ArtifactRoutingDecision | null): string | null {
  if (!decision?.applies) return null;

  const lines = [
    '## Artifact Routing',
    `Deterministic route: ${decision.action.toUpperCase()} using ${decision.mutation.toUpperCase()}.`,
    `Reason: ${decision.reason}.`,
  ];

  if (decision.action === 'create') {
    lines.push(
      decision.mutation === 'append'
        ? 'Create a managed artifact with artifact.create, then add the new content with artifact.append_content.'
        : 'Create a managed artifact with artifact.create, then populate it with artifact.replace_content.',
      'Do not use filesystem.write or filesystem.patch for this artifact workflow.',
    );
  } else if (decision.action === 'delete') {
    lines.push(
      `Target artifact: ${decision.targetArtifactTitle ?? 'active artifact'}${decision.targetArtifactFormat ? ` (${decision.targetArtifactFormat})` : ''}.`,
      'Use artifact.delete for the removal path.',
      'Do not fall back to filesystem.delete for managed artifacts.',
    );
  } else {
    lines.push(
      `Target artifact: ${decision.targetArtifactTitle ?? 'active artifact'}${decision.targetArtifactFormat ? ` (${decision.targetArtifactFormat})` : ''}.`,
      decision.mutation === 'append'
        ? 'Use artifact.append_content for the write path.'
        : 'Use artifact.replace_content for the write path.',
      'Use artifact.read first if you need the current content before replacing it.',
      'Do not use filesystem.write or filesystem.patch for this artifact workflow.',
    );
  }

  if (decision.invalidReason) {
    lines.push(
      `Invalid operation: ${decision.invalidReason}`,
      'Do not fall back to filesystem writes. Explain the limitation and choose a valid artifact action only if the user explicitly asks for it.',
    );
  }

  lines.push('After the tool call, explicitly name the artifact and the action in the final response.');
  return lines.join('\n');
}

export function withArtifactRoutingAllowedTools(
  allowedTools: 'all' | AgentToolName[],
  decision: ArtifactRoutingDecision | null,
  fullToolCatalogNames?: AgentToolName[],
): 'all' | AgentToolName[] {
  if (!decision?.applies) return allowedTools;

  const base = allowedTools === 'all'
    ? (fullToolCatalogNames ? [...fullToolCatalogNames] : 'all')
    : [...allowedTools];

  if (base === 'all') return 'all';

  const filtered = base.filter((name) => name !== 'filesystem.write' && name !== 'filesystem.patch' && name !== 'filesystem.delete');
  return Array.from(new Set([...filtered, ...ARTIFACT_ROUTE_TOOL_NAMES]));
}
