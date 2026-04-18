"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const shellIntegration_1 = require("./shellIntegration");
describe('shell integration', () => {
    it('uses PS0-based preexec markers for bash', () => {
        const script = (0, shellIntegration_1.getShellIntegrationScript)('/bin/bash');
        expect(script).toContain('__v2_precmd()');
        expect(script).toContain('PROMPT_COMMAND=');
        expect(script).toContain('PS0=');
        expect(script).not.toContain(`trap '__v2_preexec' DEBUG`);
    });
    it('keeps native preexec hooks for zsh', () => {
        const script = (0, shellIntegration_1.getShellIntegrationScript)('/bin/zsh');
        expect(script).toContain('precmd_functions+=');
        expect(script).toContain('preexec_functions+=');
    });
    it('returns null for unsupported shells', () => {
        expect((0, shellIntegration_1.getShellIntegrationScript)('/bin/fish')).toBeNull();
    });
});
//# sourceMappingURL=shellIntegration.test.js.map