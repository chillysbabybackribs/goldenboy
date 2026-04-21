import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return '/tmp';
      if (name === 'temp') return '/tmp';
      if (name === 'userData') return '/tmp';
      return '/tmp';
    },
    getAppPath: () => '/tmp',
  },
  dialog: {},
  session: {},
  shell: {},
  clipboard: {},
  BrowserWindow: class {},
  WebContentsView: class {},
  Menu: class {},
  MenuItem: class {},
  WebContents: class {},
}));

describe('tool scope benchmark', () => {
  it('prints the comparative tool-surface report', async () => {
    const { buildToolPackBenchmarkReport } = await import('./toolPackBenchmark');
    const report = buildToolPackBenchmarkReport();
    console.log(`\n${report}\n`);
    expect(report).toContain('mode-6');
    expect(report).toContain('mode-4');
    expect(report).toMatch(/Registered tools: \d+/);
  });
});
