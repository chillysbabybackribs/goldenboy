import { describe, expect, it } from 'vitest';
import { pickProviderForPrompt } from './providerRouting';
import { GEMINI_PROVIDER_ID, HAIKU_PROVIDER_ID, PRIMARY_PROVIDER_ID } from '../../shared/types/model';

describe('provider routing', () => {
  const capabilities = {
    [PRIMARY_PROVIDER_ID]: { supportsV2ToolRuntime: true },
    [HAIKU_PROVIDER_ID]: { supportsV2ToolRuntime: true },
    [GEMINI_PROVIDER_ID]: { supportsV2ToolRuntime: true },
  } as const;

  it('routes each task to a single preferred provider with research on haiku', () => {
    expect(pickProviderForPrompt('Search online for the latest SEC guidance', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(HAIKU_PROVIDER_ID);
    expect(pickProviderForPrompt('Patch this TypeScript file and run the local build', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
    expect(pickProviderForPrompt('Debug why the Electron app crashes on startup', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
    expect(pickProviderForPrompt('Review this PR diff and call out regressions', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
    expect(pickProviderForPrompt('Close out the browser tabs except the active one', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
    expect(pickProviderForPrompt('Plan a repo-wide migration strategy', [PRIMARY_PROVIDER_ID, HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
  });

  it('falls back to the remaining available provider', () => {
    expect(pickProviderForPrompt('Search for the latest Electron release notes', [PRIMARY_PROVIDER_ID], undefined, capabilities))
      .toBe(PRIMARY_PROVIDER_ID);
    expect(pickProviderForPrompt('Help me think through a product naming idea', [HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(HAIKU_PROVIDER_ID);
    expect(pickProviderForPrompt('Search online for the latest Electron release notes', [HAIKU_PROVIDER_ID], undefined, capabilities))
      .toBe(HAIKU_PROVIDER_ID);
    expect(pickProviderForPrompt('Help me think through a product naming idea', [GEMINI_PROVIDER_ID], undefined, capabilities))
      .toBe(GEMINI_PROVIDER_ID);
  });

  it('routes repo-wide planning and CI investigation to codex when available', () => {
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
