import { describe, expect, it } from 'vitest';
import {
  buildStartupStatusMessages,
  resolveExecutionBackendLabel,
} from './startupProgress';
import { HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';

describe('AgentModelService startup progress', () => {
  it('emits no user-facing startup statuses for research tasks', () => {
    expect(buildStartupStatusMessages({
      taskKind: 'research',
      browserSurfaceReady: true,
    })).toEqual([]);

    expect(buildStartupStatusMessages({
      taskKind: 'research',
      browserSurfaceReady: false,
    })).toEqual([]);
  });

  it('emits no user-facing startup statuses for browser automation', () => {
    expect(buildStartupStatusMessages({
      taskKind: 'browser-automation',
      browserSurfaceReady: true,
    })).toEqual([]);
  });

  it('reports the correct execution backend label per provider', () => {
    expect(resolveExecutionBackendLabel(PRIMARY_PROVIDER_ID)).toBe('app-server');
    expect(resolveExecutionBackendLabel(HAIKU_PROVIDER_ID)).toBe('anthropic-api');
  });
});
