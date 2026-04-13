import { describe, expect, it } from 'vitest';
import { pickProviderForPrompt } from './providerRouting';
import { HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';

describe('provider routing', () => {
  const capabilities = {
    [PRIMARY_PROVIDER_ID]: { supportsV2ToolRuntime: true },
    [HAIKU_PROVIDER_ID]: { supportsV2ToolRuntime: true },
  } as const;

  it('prefers haiku for research tasks when available', () => {
    expect(pickProviderForPrompt('Search online for the latest SEC guidance', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(HAIKU_PROVIDER_ID);
  });

  it('routes implementation, debug, and review tasks to gpt-5.4 when available', () => {
    expect(pickProviderForPrompt('Patch this TypeScript file and run the local build', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
    expect(pickProviderForPrompt('Debug why the Electron app crashes on startup', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
    expect(pickProviderForPrompt('Review this PR diff and call out regressions', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
  });

  it('falls back to the remaining available provider', () => {
    expect(pickProviderForPrompt('Search for the latest Electron release notes', [PRIMARY_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
    expect(pickProviderForPrompt('Help me think through a product naming idea', [HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(HAIKU_PROVIDER_ID);
    expect(pickProviderForPrompt('Search online for the latest Electron release notes', [HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(HAIKU_PROVIDER_ID);
  });

  it('routes repo-wide planning to gpt-5.4 and CI investigation to the debug path', () => {
    expect(pickProviderForPrompt('Plan a repo-wide migration strategy', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
    expect(pickProviderForPrompt('Investigate the failing CI and explain root cause', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
  });

  it('uses explicit task kind overrides ahead of prompt heuristics', () => {
    expect(pickProviderForPrompt(
      'Help me think through a product naming idea',
      [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID],
      { kind: 'implementation' },
      capabilities,
    )).toBe(PRIMARY_PROVIDER_ID);

    expect(pickProviderForPrompt(
      'Patch this TypeScript file and run the local build',
      [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID],
      { kind: 'research' },
      capabilities,
    )).toBe(HAIKU_PROVIDER_ID);
  });
});
