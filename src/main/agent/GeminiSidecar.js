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
exports.geminiSidecar = exports.GeminiSidecar = void 0;
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const path = __importStar(require("path"));
function loadEnvValue(key) {
    if (process.env[key])
        return process.env[key] || null;
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath))
        return null;
    const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('='))
            continue;
        const eq = trimmed.indexOf('=');
        const name = trimmed.slice(0, eq).trim();
        if (name !== key)
            continue;
        let value = trimmed.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (value) {
            process.env[key] = value;
            return value;
        }
    }
    return null;
}
function configuredModels() {
    const explicit = loadEnvValue('GEMINI_MODELS');
    if (explicit) {
        return explicit.split(',').map(model => model.trim()).filter(Boolean);
    }
    const primary = loadEnvValue('GEMINI_MODEL_PRIMARY') || 'gemini-3.1-flash-lite-preview';
    const fallbacks = (loadEnvValue('GEMINI_MODEL_FALLBACKS') || 'gemini-3-flash-preview,gemini-3.1-pro-preview,gemini-3-pro-preview,gemini-2.5-flash,gemini-2.5-pro')
        .split(',')
        .map(model => model.trim())
        .filter(Boolean);
    return Array.from(new Set([primary, ...fallbacks]));
}
function postJson(url, body) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const payload = JSON.stringify(body);
        const req = https.request({
            method: 'POST',
            hostname: parsed.hostname,
            path: `${parsed.pathname}${parsed.search}`,
            headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(payload),
            },
            timeout: 15_000,
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
            res.on('end', () => resolve({
                statusCode: res.statusCode || 0,
                body: Buffer.concat(chunks).toString('utf-8'),
            }));
        });
        req.on('timeout', () => {
            req.destroy(new Error('Gemini request timed out'));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
function extractText(response) {
    return response.candidates?.[0]?.content?.parts
        ?.map(part => part.text || '')
        .join('')
        .trim() || '';
}
function parseJsonObject(text) {
    const trimmed = text.trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
    const candidate = fenced || trimmed;
    try {
        return JSON.parse(candidate);
    }
    catch {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start < 0 || end <= start)
            return null;
        try {
            return JSON.parse(candidate.slice(start, end + 1));
        }
        catch {
            return null;
        }
    }
}
function compactText(text, maxChars) {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}...` : cleaned;
}
class GeminiSidecar {
    apiKey;
    models;
    constructor() {
        this.apiKey = loadEnvValue('GEMINI_API_KEY');
        this.models = configuredModels();
    }
    isConfigured() {
        return Boolean(this.apiKey && this.models.length > 0);
    }
    async rankSearchResults(query, results) {
        if (!this.isConfigured() || results.length < 2) {
            return { results, modelId: null, reason: null };
        }
        const payload = results.slice(0, 8).map(result => ({
            index: result.index,
            title: compactText(result.title, 140),
            url: result.url,
            snippet: compactText(result.snippet, 220),
        }));
        const prompt = [
            'Rank web search results for which should be opened first to answer the user query.',
            'Return strict JSON only: {"rankedIndices":[number],"reason":"short reason"}.',
            'Prefer official, primary, current, directly relevant pages. Avoid ads, generic listicles, login pages, and unrelated docs.',
            '',
            `Query: ${query}`,
            `Results: ${JSON.stringify(payload)}`,
        ].join('\n');
        const parsed = await this.generateJson(prompt, 512);
        if (!parsed?.json?.rankedIndices || !Array.isArray(parsed.json.rankedIndices)) {
            return { results, modelId: parsed?.modelId || null, reason: null };
        }
        const byIndex = new Map(results.map(result => [result.index, result]));
        const ranked = [];
        for (const index of parsed.json.rankedIndices) {
            const match = byIndex.get(index);
            if (match && !ranked.includes(match))
                ranked.push(match);
        }
        for (const result of results) {
            if (!ranked.includes(result))
                ranked.push(result);
        }
        return {
            results: ranked,
            modelId: parsed.modelId,
            reason: typeof parsed.json.reason === 'string' ? parsed.json.reason : null,
        };
    }
    async judgeEvidence(input) {
        if (!this.isConfigured())
            return null;
        const prompt = [
            'Decide whether the provided browser-observed evidence is enough to answer the user query.',
            'Return strict JSON only: {"sufficient":boolean,"score":number,"reasons":["short"],"compactEvidence":["short factual evidence"]}.',
            'Score is 0 to 10. sufficient should be true only when the evidence directly answers the query.',
            '',
            `Query: ${input.query}`,
            `Page: ${input.title} ${input.url}`,
            `Summary: ${compactText(input.summary, 700)}`,
            `Key facts: ${JSON.stringify(input.keyFacts.map(fact => compactText(fact, 260)).slice(0, 5))}`,
            `Cached snippets: ${JSON.stringify(input.snippets.map(snippet => compactText(snippet, 320)).slice(0, 4))}`,
        ].join('\n');
        const parsed = await this.generateJson(prompt, 768);
        if (!parsed?.json || typeof parsed.json.sufficient !== 'boolean')
            return null;
        return {
            sufficient: parsed.json.sufficient,
            score: typeof parsed.json.score === 'number' ? parsed.json.score : 0,
            reasons: Array.isArray(parsed.json.reasons) ? parsed.json.reasons.filter((item) => typeof item === 'string').slice(0, 4) : [],
            compactEvidence: Array.isArray(parsed.json.compactEvidence) ? parsed.json.compactEvidence.filter((item) => typeof item === 'string').slice(0, 5) : [],
            modelId: parsed.modelId,
        };
    }
    async generateJson(prompt, maxOutputTokens) {
        // Try all Gemini models first
        if (this.apiKey) {
            for (const modelId of this.models) {
                const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
                try {
                    const response = await postJson(url, {
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0,
                            maxOutputTokens,
                            responseMimeType: 'application/json',
                        },
                    });
                    const body = JSON.parse(response.body);
                    if (response.statusCode >= 400 || body.error) {
                        if (response.statusCode === 429 || response.statusCode === 403 || body.error?.status === 'RESOURCE_EXHAUSTED') {
                            continue;
                        }
                        continue;
                    }
                    const text = extractText(body);
                    const json = parseJsonObject(text);
                    if (json)
                        return { json, modelId };
                }
                catch {
                    continue;
                }
            }
        }
        return null;
    }
}
exports.GeminiSidecar = GeminiSidecar;
exports.geminiSidecar = new GeminiSidecar();
//# sourceMappingURL=GeminiSidecar.js.map