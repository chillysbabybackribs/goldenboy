import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'home') return '/tmp';
      if (name === 'temp') return '/tmp';
      if (name === 'userData') return '/tmp';
      return '/tmp';
    },
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

const describeIf = process.env.RUN_TOOL_BENCHMARK ? describe : describe.skip;

describeIf('tool pack benchmark', () => {
  it('prints the comparative tool-surface report', async () => {
    const { buildToolPackBenchmarkReport } = await import('./toolPackBenchmark');
    const report = buildToolPackBenchmarkReport();
    console.log(`\n${report}\n`);
    expect(report).toContain('mode-6');
    expect(report).toContain('mode-4');
    expect(report).toContain('Registered tools: 74');
  });
});
