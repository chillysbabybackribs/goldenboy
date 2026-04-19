import {
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
  type AgentTaskKind,
  type AgentTaskProfileOverride,
  type ProviderId,
} from '../../shared/types/model';
import { buildTaskProfile } from './taskProfile';

const DEFAULT_PROVIDER_ORDER: ProviderId[] = [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID];

export type PrimaryProviderBackend = 'exec' | 'app-server';

export type ProviderRoutingCapabilities = Partial<Record<ProviderId, {
  supportsV2ToolRuntime: boolean;
}>>;

export function taskKindRequiresV2ToolRuntime(kind: AgentTaskKind): boolean {
  return kind === 'orchestration'
    || kind === 'research'
    || kind === 'browser-automation'
    || kind === 'implementation'
    || kind === 'debug'
    || kind === 'review';
}

export function shouldPreferExecForTaskKind(taskKind: AgentTaskKind): boolean {
  return taskKind === 'implementation' || taskKind === 'debug' || taskKind === 'review';
}

export function resolvePrimaryProviderBackend(
  taskKind: AgentTaskKind,
  configuredMode = process.env.CODEX_PROVIDER,
  execAvailable = true,
): PrimaryProviderBackend {
  void taskKind;
  if (!execAvailable) return 'app-server';
  if (configuredMode === 'exec') return 'exec';
  return 'app-server';
}

export function providerSupportsPrompt(
  providerId: ProviderId,
  prompt: string,
  overrides?: AgentTaskProfileOverride,
  capabilities?: ProviderRoutingCapabilities,
): boolean {
  const profile = buildTaskProfile(prompt, overrides);
  if (!taskKindRequiresV2ToolRuntime(profile.kind)) return true;
  if (!capabilities) return true;
  return capabilities[providerId]?.supportsV2ToolRuntime === true;
}

export function pickProviderForPrompt(
  prompt: string,
  availableProviders: Iterable<ProviderId>,
  overrides?: AgentTaskProfileOverride,
  capabilities?: ProviderRoutingCapabilities,
): ProviderId | null {
  const available = new Set(
    Array.from(availableProviders).filter((providerId) => providerSupportsPrompt(
      providerId,
      prompt,
      overrides,
      capabilities,
    )),
  );
  const profile = buildTaskProfile(prompt, overrides);

  if (available.size === 0) return null;

  if (profile.kind === 'research') {
    if (available.has(PRIMARY_PROVIDER_ID)) return PRIMARY_PROVIDER_ID;
    if (available.has(HAIKU_PROVIDER_ID)) return HAIKU_PROVIDER_ID;
  }

  if (profile.kind === 'browser-automation') {
    if (available.has(PRIMARY_PROVIDER_ID)) return PRIMARY_PROVIDER_ID;
    if (available.has(HAIKU_PROVIDER_ID)) return HAIKU_PROVIDER_ID;
  }

  if (profile.kind === 'implementation') {
    if (available.has(PRIMARY_PROVIDER_ID)) return PRIMARY_PROVIDER_ID;
    if (available.has(HAIKU_PROVIDER_ID)) return HAIKU_PROVIDER_ID;
  }

  if (
    profile.kind === 'orchestration'
    || profile.kind === 'review'
    || profile.kind === 'debug'
  ) {
    if (available.has(PRIMARY_PROVIDER_ID)) return PRIMARY_PROVIDER_ID;
    if (available.has(HAIKU_PROVIDER_ID)) return HAIKU_PROVIDER_ID;
  }

  for (const providerId of DEFAULT_PROVIDER_ORDER) {
    if (available.has(providerId)) return providerId;
  }

  return null;
}
