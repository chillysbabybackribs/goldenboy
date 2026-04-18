import {
  HAIKU_PROVIDER_ID,
  PRIMARY_PROVIDER_ID,
  type AgentTaskKind,
  type ProviderId,
} from '../../shared/types/model';

export function buildStartupStatusMessages(input: {
  taskKind: AgentTaskKind;
  browserSurfaceReady: boolean;
}): string[] {
  void input;
  return [];
}

export function resolveExecutionBackendLabel(providerId: ProviderId): string {
  if (providerId === PRIMARY_PROVIDER_ID) return 'app-server';
  if (providerId === HAIKU_PROVIDER_ID) return 'anthropic-api';
  return 'runtime';
}
