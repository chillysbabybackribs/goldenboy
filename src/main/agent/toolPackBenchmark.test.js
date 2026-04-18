"use strict";
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
const vitest_1 = require("vitest");
vitest_1.vi.mock('electron', () => ({
    app: {
        getPath: (name) => {
            if (name === 'home')
                return '/tmp';
            if (name === 'temp')
                return '/tmp';
            if (name === 'userData')
                return '/tmp';
            return '/tmp';
        },
    },
    dialog: {},
    session: {},
    shell: {},
    clipboard: {},
    BrowserWindow: class {
    },
    WebContentsView: class {
    },
    Menu: class {
    },
    MenuItem: class {
    },
    WebContents: class {
    },
}));
const describeIf = process.env.RUN_TOOL_BENCHMARK ? vitest_1.describe : vitest_1.describe.skip;
describeIf('tool pack benchmark', () => {
    (0, vitest_1.it)('prints the comparative tool-surface report', async () => {
        const { buildToolPackBenchmarkReport } = await Promise.resolve().then(() => __importStar(require('./toolPackBenchmark')));
        const report = buildToolPackBenchmarkReport();
        console.log(`\n${report}\n`);
        (0, vitest_1.expect)(report).toContain('mode-6');
        (0, vitest_1.expect)(report).toContain('mode-4');
        (0, vitest_1.expect)(report).toMatch(/Registered tools: \d+/);
    });
});
//# sourceMappingURL=toolPackBenchmark.test.js.map