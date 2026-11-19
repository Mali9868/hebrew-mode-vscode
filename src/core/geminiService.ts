/**
 * Gemini Service: HTTPS calls to the Gemini API, model listing, error
 * mapping and an in-memory cache. No VS Code dependency.
 *
 * The API key is sent only in the x-goog-api-key header, never in the URL,
 * and is never included in errors or logs. There is no logging at all.
 */
import { createHash } from 'node:crypto';
import { Direction, protect, restore, Span } from './contentProtector';
import { TranslationError, redact } from './errors';
import { MESSAGES } from './messages';
import { ApiModel, ModelTier, majorVersion, pickModel, supportsGenerateContent } from './models';
import { PROMPT_VERSION, systemInstruction } from './prompts';
import { nextPacificMidnight } from './time';

export const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const TIMEOUT_MS = 20_000;
export const TEMPERATURE = 0.2;

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface TranslateRequest {
  text: string;
  direction: Direction;
  model: string;
  glossary?: readonly string[];
  /** Spans in `text` to protect in addition to the defaults (masked secrets). */
  extraSpans?: readonly Span[];
}

export interface TranslateResult {
  text: string;
  fromCache: boolean;
  /** True when a request was actually sent to Gemini. */
  sent: boolean;
}

interface GoogleErrorBody {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{
      '@type'?: string;
      reason?: string;
      retryDelay?: string;
      violations?: Array<{ quotaId?: string; quotaMetric?: string }>;
    }>;
  };
}

/** Bidi control characters (LRM, RLM, embeddings, isolates) copied from RTL text. */
const BIDI_CONTROLS = /\p{Bidi_Control}/gu;

export class GeminiService {
  private readonly cache = new Map<string, string>();
  private static readonly CACHE_LIMIT = 200;

  constructor(
    private readonly getKey: () => Promise<string | undefined>,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike,
    private readonly now: () => Date = () => new Date(),
    private readonly timeoutMs: number = TIMEOUT_MS,
  ) {}

  /** Lists models available to the key that support generateContent. */
  async listModels(keyOverride?: string): Promise<ApiModel[]> {
    const key = keyOverride ?? (await this.requireKey());
    const models: ApiModel[] = [];
    let pageToken = '';
    for (let page = 0; page < 10; page++) {
      const url = `${API_BASE}/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
      const body = await this.request('GET', url, key);
      let parsed: { models?: ApiModel[]; nextPageToken?: string };
      try {
        parsed = JSON.parse(body) as { models?: ApiModel[]; nextPageToken?: string };
      } catch {
        throw new TranslationError('badResponse', MESSAGES.failed);
      }
      models.push(...(parsed.models ?? []));
      if (!parsed.nextPageToken) break;
      pageToken = parsed.nextPageToken;
    }
    return models.filter(supportsGenerateContent);
  }

  /**
   * Validates the key (by listing its models) and returns the newest stable
   * model of the tier. Uses the stored key when none is given.
   */
  async pickModel(tier: ModelTier, key?: string): Promise<string> {
    const models = await this.listModels(key);
    const model = pickModel(models, tier);
    if (!model) throw new TranslationError('modelUnavailable', MESSAGES.noStableModel(tier));
    return model;
  }

  async translate(req: TranslateRequest): Promise<TranslateResult> {
    const protectedText = protect(req.text, { glossary: req.glossary, extraSpans: req.extraSpans, direction: req.direction });
    if (protectedText.onlyProtected) {
      return { text: req.text, fromCache: false, sent: false };
    }

    const cacheKey = this.cacheKey(req, protectedText.text);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      const restored = restore(cached, protectedText.items);
      if (restored.ok) return { text: restored.text, fromCache: true, sent: false };
      this.cache.delete(cacheKey);
    }

    const key = await this.requireKey();
    // Send without surrounding whitespace and put the original whitespace back afterwards.
    const lead = /^\s*/.exec(protectedText.text)?.[0] ?? '';
    const trail = /\s*$/.exec(protectedText.text)?.[0] ?? '';
    const core = protectedText.text.slice(lead.length, protectedText.text.length - trail.length);
    let translated = (await this.generate(key, req.model, req.direction, core)).trim();
    if (req.direction === 'he-en') translated = translated.replace(BIDI_CONTROLS, '');
    const raw = lead + translated + trail;

    const restored = restore(raw, protectedText.items);
    if (!restored.ok) throw new TranslationError('placeholders', MESSAGES.placeholders);
    this.remember(cacheKey, raw);
    return { text: restored.text, fromCache: false, sent: true };
  }

  clearCache(): void {
    this.cache.clear();
  }

  private cacheKey(req: TranslateRequest, protectedText: string): string {
    return createHash('sha256')
      .update(JSON.stringify([PROMPT_VERSION, req.direction, req.model, protectedText]))
      .digest('hex');
  }

  private remember(key: string, value: string): void {
    if (this.cache.size >= GeminiService.CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }

  private async requireKey(): Promise<string> {
    const key = (await this.getKey())?.trim();
    if (!key) throw new TranslationError('missingKey', MESSAGES.missingKey);
    return key;
  }

  private async generate(key: string, model: string, direction: Direction, text: string): Promise<string> {
    const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;
    const thinkingConfig = majorVersion(model) >= 3 ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 };
    const makeBody = (withThinking: boolean): string =>
      JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction(direction) }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: TEMPERATURE, ...(withThinking ? { thinkingConfig } : {}) },
      });

    let body: string;
    try {
      body = await this.request('POST', url, key, makeBody(true));
    } catch (e) {
      // Some models reject thinking settings. Retry once without them.
      if (e instanceof ThinkingConfigRejected) body = await this.request('POST', url, key, makeBody(false));
      else throw e;
    }
    return parseGenerateResponse(body);
  }

  /** One HTTPS request with a timeout and one retry on transient network errors only. */
  private async request(method: string, url: string, key: string, body?: string): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        });
        const text = await res.text();
        if (res.ok) return text;
        throw this.mapHttpError(res.status, text, key);
      } catch (e) {
        if (e instanceof TranslationError || e instanceof ThinkingConfigRejected) throw e;
        if (controller.signal.aborted) throw new TranslationError('timeout', MESSAGES.timeout);
        // Transient network error (DNS, reset, refused): retry once. The raw error is never surfaced.
      } finally {
        clearTimeout(timer);
      }
    }
    throw new TranslationError('network', MESSAGES.failed);
  }

  private mapHttpError(status: number, bodyText: string, key: string): Error {
    let body: GoogleErrorBody = {};
    try {
      body = JSON.parse(bodyText) as GoogleErrorBody;
    } catch {
      /* non-JSON error body */
    }
    const err = body.error ?? {};
    const details = err.details ?? [];
    const message = redact(err.message ?? '', key);
    const reasons = details.map((d) => d.reason ?? '');

    if (status === 400 && /thinking/i.test(message)) return new ThinkingConfigRejected();
    if (
      status === 401 ||
      reasons.includes('API_KEY_INVALID') ||
      reasons.includes('API_KEY_EXPIRED') ||
      (status === 400 && /api key/i.test(message)) ||
      (status === 403 && (reasons.includes('API_KEY_SERVICE_BLOCKED') || err.status === 'PERMISSION_DENIED'))
    ) {
      return new TranslationError('invalidKey', MESSAGES.invalidKey, { status });
    }
    if (status === 429) {
      const quotaIds = details.flatMap((d) => d.violations ?? []).map((v) => `${v.quotaId ?? ''} ${v.quotaMetric ?? ''}`);
      const daily = quotaIds.some((q) => /PerDay/i.test(q)) || (quotaIds.length === 0 && /per day|daily/i.test(message));
      if (daily) {
        const resetAt = nextPacificMidnight(this.now());
        return new TranslationError('quotaDaily', MESSAGES.quotaDaily(resetAt), { status, resetAt });
      }
      const retryAfterSec = parseRetryDelay(details.find((d) => d.retryDelay)?.retryDelay) ?? parseRetryFromMessage(message) ?? 60;
      return new TranslationError('rateLimitMinute', MESSAGES.rateLimitMinute(retryAfterSec), { status, retryAfterSec });
    }
    if (status === 404) return new TranslationError('modelUnavailable', MESSAGES.modelUnavailable, { status });
    return new TranslationError('badResponse', MESSAGES.failed, { status });
  }
}

class ThinkingConfigRejected extends Error {}

function parseRetryDelay(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const m = /^(\d+(?:\.\d+)?)s$/.exec(v.trim());
  return m && m[1] ? Math.max(1, Math.ceil(Number(m[1]))) : undefined;
}

function parseRetryFromMessage(msg: string): number | undefined {
  const m = /retry in (\d+(?:\.\d+)?)\s*s/i.exec(msg);
  return m && m[1] ? Math.max(1, Math.ceil(Number(m[1]))) : undefined;
}

export function parseGenerateResponse(body: string): string {
  let parsed: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
  };
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    throw new TranslationError('badResponse', MESSAGES.failed);
  }
  if (parsed.promptFeedback?.blockReason) throw new TranslationError('blocked', MESSAGES.blocked);
  const cand = parsed.candidates?.[0];
  if (!cand) throw new TranslationError('badResponse', MESSAGES.failed);
  if (cand.finishReason && cand.finishReason !== 'STOP') {
    const blocked = ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(cand.finishReason);
    throw new TranslationError(blocked ? 'blocked' : 'badResponse', blocked ? MESSAGES.blocked : MESSAGES.failed);
  }
  const text = (cand.content?.parts ?? [])
    .filter((p) => !p.thought)
    .map((p) => p.text ?? '')
    .join('');
  if (text.trim() === '') throw new TranslationError('badResponse', MESSAGES.failed);
  return text;
}
