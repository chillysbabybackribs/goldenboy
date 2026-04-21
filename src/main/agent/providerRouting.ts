import {
  GEMINI_PROVIDER_ID,
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
  type AgentTaskKind,
  type AgentTaskProfileOverride,
  type ProviderId,
} from '../../shared/types/model';
import { buildTaskProfile } from './taskProfile';

const DEFAULT_PROVIDER_ORDER: ProviderId[] = [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID, GEMINI_PROVIDER_ID];

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

  const preferredProvider = profile.kind === 'research'
    ? HAIKU_PROVIDER_ID
    : PRIMARY_PROVIDER_ID;
  if (available.has(preferredProvider)) return preferredProvider;

  for (const providerId of DEFAULT_PROVIDER_ORDER) {
    if (available.has(providerId)) return providerId;
  }

  return null;
}
