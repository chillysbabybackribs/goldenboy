import { parseOscSequences } from './oscParser';

describe('parseOscSequences', () => {
  it('preserves text ordering around OSC 633 markers', () => {
    const data = '\x1b]633;C\x07hello\r\n\x1b]633;E;0\x07\x1b]633;B\x07';
    const result = parseOscSequences(data);

    expect(result.cleaned).toBe('hello\r\n');
    expect(result.events).toEqual([
      { type: 'command-started' },
      { type: 'exit-code', code: 0 },
      { type: 'prompt-started' },
    ]);
    expect(result.parts).toEqual([
      { type: 'event', event: { type: 'command-started' } },
      { type: 'text', value: 'hello\r\n' },
      { type: 'event', event: { type: 'exit-code', code: 0 } },
      { type: 'event', event: { type: 'prompt-started' } },
    ]);
  });
});
