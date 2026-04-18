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
exports.normalizeNavigationTarget = normalizeNavigationTarget;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const url_1 = require("url");
const workspaceRoot_1 = require("../workspaceRoot");
const SEARCH_ENGINES = {
    google: 'https://www.google.com/search?q=',
    duckduckgo: 'https://duckduckgo.com/?q=',
    bing: 'https://www.bing.com/search?q=',
};
const URL_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;
const IPV4_WITH_PORT_RE = /^(\d{1,3})(?:\.(\d{1,3})){3}(?::\d{1,5})?$/;
const LOCALHOST_WITH_PORT_RE = /^localhost(?::\d{1,5})?$/i;
const BRACKETED_IPV6_WITH_PORT_RE = /^\[[0-9a-f:.]+\](?::\d{1,5})?$/i;
const DOMAIN_WITH_PORT_RE = /^(?:[a-z0-9-]+\.)+[a-z0-9-]{2,}(?::\d{1,5})?$/i;
const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'file:']);
function normalizeNavigationTarget(rawInput, input) {
    const trimmed = rawInput.trim();
    if (!trimmed) {
        return {
            url: SEARCH_ENGINES[input.searchEngine] || SEARCH_ENGINES.google,
            kind: 'search',
        };
    }
    if (URL_SCHEME_RE.test(trimmed)) {
        const searchPrefix = SEARCH_ENGINES[input.searchEngine] || SEARCH_ENGINES.google;
        const normalizedByScheme = normalizeExplicitScheme(trimmed, searchPrefix);
        return normalizedByScheme;
    }
    const localFileUrl = normalizeLocalFileUrl(trimmed, input.cwd || workspaceRoot_1.APP_WORKSPACE_ROOT);
    if (localFileUrl) {
        return {
            url: localFileUrl,
            kind: 'local-file',
        };
    }
    if (!/\s/.test(trimmed) && looksLikeHostOrDomain(trimmed)) {
        const scheme = shouldUseHttp(trimmed) ? 'http://' : 'https://';
        return {
            url: `${scheme}${trimmed}`,
            kind: 'direct-url',
        };
    }
    const prefix = SEARCH_ENGINES[input.searchEngine] || SEARCH_ENGINES.google;
    return {
        url: `${prefix}${encodeURIComponent(trimmed)}`,
        kind: 'search',
    };
}
function normalizeExplicitScheme(trimmed, searchPrefix) {
    if (trimmed.toLowerCase() === 'about:blank') {
        return { url: 'about:blank', kind: 'direct-url' };
    }
    try {
        const parsed = new URL(trimmed);
        if (SAFE_URL_PROTOCOLS.has(parsed.protocol.toLowerCase())) {
            return { url: trimmed, kind: 'direct-url' };
        }
    }
    catch {
        return { url: `${searchPrefix}${encodeURIComponent(trimmed)}`, kind: 'search' };
    }
    return { url: `${searchPrefix}${encodeURIComponent(trimmed)}`, kind: 'search' };
}
function normalizeLocalFileUrl(rawInput, cwd) {
    const resolved = resolvePathLikeInput(rawInput, cwd);
    if (!resolved || !fs.existsSync(resolved))
        return null;
    return (0, url_1.pathToFileURL)(resolved).href;
}
function resolvePathLikeInput(rawInput, cwd) {
    if (rawInput.startsWith('~/')) {
        return path.join(os.homedir(), rawInput.slice(2));
    }
    if (path.isAbsolute(rawInput)) {
        return rawInput;
    }
    if (rawInput.startsWith('./') || rawInput.startsWith('../')) {
        return path.resolve(cwd, rawInput);
    }
    const relativePathLike = rawInput.includes('/') || rawInput.includes('\\') || path.extname(rawInput) !== '';
    if (relativePathLike) {
        return path.resolve(cwd, rawInput);
    }
    return null;
}
function looksLikeHostOrDomain(value) {
    const host = hostToken(value);
    if (!host)
        return false;
    if (LOCALHOST_WITH_PORT_RE.test(host))
        return true;
    if (BRACKETED_IPV6_WITH_PORT_RE.test(host))
        return true;
    if (isIpv4WithOptionalPort(host))
        return true;
    if (host.startsWith('www.'))
        return true;
    return DOMAIN_WITH_PORT_RE.test(host);
}
function shouldUseHttp(value) {
    const host = hostToken(value).toLowerCase();
    if (LOCALHOST_WITH_PORT_RE.test(host))
        return true;
    if (BRACKETED_IPV6_WITH_PORT_RE.test(host))
        return true;
    return isIpv4WithOptionalPort(host);
}
function hostToken(value) {
    return value.split(/[/?#]/, 1)[0] || '';
}
function isIpv4WithOptionalPort(value) {
    if (!IPV4_WITH_PORT_RE.test(value))
        return false;
    const [host] = value.split(':', 1);
    return host.split('.').every((part) => {
        const n = Number(part);
        return Number.isInteger(n) && n >= 0 && n <= 255;
    });
}
//# sourceMappingURL=navigationTarget.js.map