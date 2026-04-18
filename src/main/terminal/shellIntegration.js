"use strict";
// ═══════════════════════════════════════════════════════════════════════════
// Shell Integration — Injects OSC 633 hooks into bash/zsh at PTY spawn
// ═══════════════════════════════════════════════════════════════════════════
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShellIntegrationScript = getShellIntegrationScript;
const path = __importStar(require("path"));
function detectShellType(shellPath) {
    const name = path.basename(shellPath);
    if (name === 'bash')
        return 'bash';
    if (name === 'zsh')
        return 'zsh';
    return null;
}
const BASH_INTEGRATION = `
__v2_precmd() { local ec=$?; printf '\\x1b]633;E;%d\\x07' "$ec"; printf '\\x1b]633;D;%s\\x07' "$PWD"; printf '\\x1b]633;B\\x07'; }
PROMPT_COMMAND="__v2_precmd\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
__v2_original_ps0=\${PS0-}
PS0='$(printf "\\x1b]633;C\\x07\\x1b]633;D;%s\\x07" "$PWD")'"\${__v2_original_ps0}"
`.trim();
const ZSH_INTEGRATION = `
__v2_precmd() { local ec=$?; printf '\\x1b]633;E;%d\\x07' "$ec"; printf '\\x1b]633;D;%s\\x07' "$PWD"; printf '\\x1b]633;B\\x07'; }
__v2_preexec() { printf '\\x1b]633;C\\x07'; printf '\\x1b]633;D;%s\\x07' "$PWD"; }
precmd_functions+=(__v2_precmd)
preexec_functions+=(__v2_preexec)
`.trim();
function getShellIntegrationScript(shellPath) {
    if (!shellPath)
        return null;
    const type = detectShellType(shellPath);
    switch (type) {
        case 'bash': return BASH_INTEGRATION;
        case 'zsh': return ZSH_INTEGRATION;
        default: return null;
    }
}
//# sourceMappingURL=shellIntegration.js.map