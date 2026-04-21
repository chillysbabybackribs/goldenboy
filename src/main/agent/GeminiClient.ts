import * as fs from 'fs';
import * as https from 'https';
import type { IncomingMessage } from 'http';
import * as path from 'path';

export type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { functionCall: { name: string; args?: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

export type GeminiContent = {
  role: 'user' | 'model';
  parts: GeminiPart[];
};

export type GeminiFunctionDeclaration = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      role?: 'user' | 'model';
      parts?: GeminiPart[];
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

export type GeminiCachedContentResponse = {
  name?: string;
  expireTime?: string;
  usageMetadata?: {
    totalTokenCount?: number;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

export function loadGeminiEnvValue(key: string): string | null {
  if (process.env[key]) return process.env[key] || null;

  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return null;

  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const name = trimmed.slice(0, eq).trim();
    if (name !== key) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) {
      process.env[key] = value;
      return value;
    }
  }
  return null;
}

function orderedUnique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    ordered.push(trimmed);
  }
  return ordered;
}

export function configuredGeminiFallbackModels(defaults: {
  liteModelId: string;
  fastModelId: string;
  defaultModelId: string;
  complexModelId: string;
}): string[] {
  const explicit = loadGeminiEnvValue('GEMINI_MODELS');
  if (explicit) {
    return explicit.split(',').map(model => model.trim()).filter(Boolean);
  }

  const legacyPrimary = loadGeminiEnvValue('GEMINI_MODEL_PRIMARY');
  const legacyFallbacks = (loadGeminiEnvValue('GEMINI_MODEL_FALLBACKS') || '')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);

  return orderedUnique([
    loadGeminiEnvValue('GEMINI_MODEL_LITE') || defaults.liteModelId,
    loadGeminiEnvValue('GEMINI_MODEL_FAST') || defaults.fastModelId,
    loadGeminiEnvValue('GEMINI_MODEL_DEFAULT') || defaults.defaultModelId,
    loadGeminiEnvValue('GEMINI_MODEL_COMPLEX') || defaults.complexModelId,
    legacyPrimary,
    ...legacyFallbacks,
  ]);
}

export function extractGeminiText(response: GeminiGenerateResponse): string {
  return response.candidates?.[0]?.content?.parts
    ?.filter((part): part is Extract<GeminiPart, { text: string }> => typeof (part as { text?: unknown }).text === 'string')
    .map(part => part.text)
    .join('')
    .trim() || '';
}

export function parseGeminiJsonObject<T>(text: string): T | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1)) as T;
    } catch {
      return null;
    }
  }
}

export class GeminiClient {
  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs = 15_000,
  ) {}

  async generateContent(input: {
    modelId: string;
    contents: GeminiContent[];
    systemPrompt?: string;
    tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;
    allowFunctionCalls?: boolean;
    maxOutputTokens?: number;
    responseMimeType?: string;
    thinkingBudget?: number | null;
    cachedContent?: string;
  }): Promise<GeminiGenerateResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await this.performGenerateContentRequest(input);
        const body = JSON.parse(response.body) as GeminiGenerateResponse;
        if (response.statusCode >= 400 || body.error) {
          const message = body.error?.message || `Gemini request failed with HTTP ${response.statusCode}`;
          throw new Error(message);
        }
        return body;
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        lastError = normalized;
        if (!shouldRetryGeminiError(normalized) || attempt === 1) {
          throw normalized;
        }
      }
    }

    throw lastError || new Error('Gemini request failed.');
  }

  private async performGenerateContentRequest(input: {
    modelId: string;
    contents: GeminiContent[];
    systemPrompt?: string;
    tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;
    allowFunctionCalls?: boolean;
    maxOutputTokens?: number;
    responseMimeType?: string;
    thinkingBudget?: number | null;
    cachedContent?: string;
  }): Promise<{ statusCode: number; body: string }> {
    const url = new URL(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.modelId)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
    );
    const usingCachedContent = typeof input.cachedContent === 'string' && input.cachedContent.trim().length > 0;
    const payload = JSON.stringify({
      cachedContent: input.cachedContent,
      systemInstruction: !usingCachedContent && input.systemPrompt
        ? { parts: [{ text: input.systemPrompt }] }
        : undefined,
      contents: input.contents,
      tools: usingCachedContent ? undefined : input.tools,
      toolConfig: !usingCachedContent && input.allowFunctionCalls && input.tools?.length
        ? { functionCallingConfig: { mode: 'AUTO' } }
        : undefined,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: input.maxOutputTokens,
        responseMimeType: input.responseMimeType,
        thinkingConfig: typeof input.thinkingBudget === 'number'
          ? { thinkingBudget: input.thinkingBudget }
          : undefined,
      },
    });

    return this.performJsonRequest(url, payload);
  }

  async createCachedContent(input: {
    modelId: string;
    systemPrompt?: string;
    contents?: GeminiContent[];
    tools?: Array<{ functionDeclarations: GeminiFunctionDeclaration[] }>;
    allowFunctionCalls?: boolean;
    ttlSeconds?: number;
  }): Promise<GeminiCachedContentResponse> {
    const url = new URL(
      `https://generativelanguage.googleapis.com/v1beta/cachedContents?key=${encodeURIComponent(this.apiKey)}`,
    );
    const modelName = input.modelId.startsWith('models/') ? input.modelId : `models/${input.modelId}`;
    const payload = JSON.stringify({
      model: modelName,
      contents: input.contents,
      systemInstruction: input.systemPrompt
        ? { parts: [{ text: input.systemPrompt }] }
        : undefined,
      tools: input.tools,
      toolConfig: input.allowFunctionCalls && input.tools?.length
        ? { functionCallingConfig: { mode: 'AUTO' } }
        : undefined,
      ttl: `${Math.max(60, input.ttlSeconds ?? 1800)}s`,
    });
    const response = await this.performJsonRequest(url, payload);
    const body = JSON.parse(response.body) as GeminiCachedContentResponse;
    if (response.statusCode >= 400 || body.error) {
      const message = body.error?.message || `Gemini cache request failed with HTTP ${response.statusCode}`;
      throw new Error(message);
    }
    return body;
  }

  private async performJsonRequest(url: URL, payload: string): Promise<{ statusCode: number; body: string }> {
    return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const request = https.request(
        {
          method: 'POST',
          hostname: url.hostname,
          path: `${url.pathname}${url.search}`,
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
          },
          timeout: this.timeoutMs,
        },
        (res: IncomingMessage) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          res.on('end', () => resolve({
            statusCode: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          }));
        },
      );
      request.on('timeout', () => {
        request.destroy(new Error('Gemini request timed out'));
      });
      request.on('error', reject);
      request.write(payload);
      request.end();
    });
  }

  async generateJsonWithFallback<T>(input: {
    models: string[];
    prompt: string;
    maxOutputTokens: number;
  }): Promise<{ json: T; modelId: string } | null> {
    for (const modelId of input.models) {
      try {
        const response = await this.generateContent({
          modelId,
          contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
          maxOutputTokens: input.maxOutputTokens,
          responseMimeType: 'application/json',
        });
        const json = parseGeminiJsonObject<T>(extractGeminiText(response));
        if (json) return { json, modelId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          message.includes('429')
          || message.includes('403')
          || message.includes('RESOURCE_EXHAUSTED')
        ) {
          continue;
        }
        continue;
      }
    }
    return null;
  }
}

function shouldRetryGeminiError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('timed out')
    || message.includes('timeout')
    || message.includes('http 429')
    || message.includes('resource_exhausted')
    || message.includes('unavailable')
    || message.includes('internal')
    || message.includes('http 500')
    || message.includes('http 502')
    || message.includes('http 503')
    || message.includes('http 504')
  );
}
