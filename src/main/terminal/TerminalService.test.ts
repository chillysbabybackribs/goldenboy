import { describe, expect, it } from 'vitest';
import { buildTrackedExecCommand } from './TerminalService';

describe('TerminalService tracked exec wrapper', () => {
  it('wraps commands with explicit OSC tracking markers through bash', () => {
    const wrapped = buildTrackedExecCommand('npm test', '/bin/bash');
    expect(wrapped).toContain('/bin/bash -lc');
    expect(wrapped).toContain('npm test');
    expect(wrapped).toContain('\\x1b]633;C\\x07');
    expect(wrapped).toContain('\\x1b]633;E;%d\\x07');
    expect(wrapped).toContain('\\x1b]633;B\\x07');
  });

  it('supports an explicit /bin/sh fallback', () => {
    const wrapped = buildTrackedExecCommand('pwd', '/bin/sh');
    expect(wrapped).toContain('/bin/sh -lc');
  });
});
