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
exports.agentSkillLoader = exports.AgentSkillLoader = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const workspaceRoot_1 = require("../workspaceRoot");
const SKILLS_DIR = (0, workspaceRoot_1.resolveWorkspacePath)('skills');
class AgentSkillLoader {
    skillCache = new Map();
    listSkillNames() {
        if (!fs.existsSync(SKILLS_DIR))
            return [];
        return fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort();
    }
    loadSkill(name) {
        const skillPath = path.join(SKILLS_DIR, name, 'SKILL.md');
        if (!fs.existsSync(skillPath)) {
            throw new Error(`Skill not found: ${name}`);
        }
        const stat = fs.statSync(skillPath);
        const cached = this.skillCache.get(name);
        if (cached && cached.skill.path === skillPath && cached.mtimeMs === stat.mtimeMs) {
            return { ...cached.skill };
        }
        const skill = {
            name,
            path: skillPath,
            body: fs.readFileSync(skillPath, 'utf-8'),
        };
        this.skillCache.set(name, { skill, mtimeMs: stat.mtimeMs });
        return { ...skill };
    }
    loadSkills(names) {
        return names.map(name => this.loadSkill(name));
    }
}
exports.AgentSkillLoader = AgentSkillLoader;
exports.agentSkillLoader = new AgentSkillLoader();
//# sourceMappingURL=AgentSkillLoader.js.map