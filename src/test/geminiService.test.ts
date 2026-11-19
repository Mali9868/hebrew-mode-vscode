import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GeminiService, FetchLike, API_BASE } from '../core/geminiService';
import { TranslationError } from '../core/errors';
import { nextPacificMidnight, formatIsraelTime, pacificDateKey } from '../core/time';

const KEY = 'TEST-KEY-1234567890';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

type Responder = (call: Call, n: number) => { status: number; body: unknown } | Error | 'hang';

function mockFetch(responder: Responder): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchLike = (url, init) => {
    const call: Call = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(call);
    const r = responder(call, calls.length);
    if (r === 'hang') {
      return new Promise((_, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve({ ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) });
  };
  return { fetch, calls };
}

/** Echo translator: sends back the prompt text with Hebrew words replaced. */
function okTranslation(call: Call): { status: number; body: unknown } {
  const body = JSON.parse(call.body ?? '{}') as { contents: Array<{ parts: Array<{ text: string }> }> };
  const text = body.contents[0]?.parts[0]?.text ?? '';
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: text.replace(/[\u05D0-\u05EA]+/g, 'word') }] }, finishReason: 'STOP' }] } };
}

async function expectError(p: Promise<unknown>, kind: string): Promise<TranslationError> {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof TranslationError, `expected TranslationError, got ${String(e)}`);
    assert.equal(e.kind, kind);
    assert.ok(!e.message.includes(KEY), 'error never contains the key');
    return e;
  }
  assert.fail(`expected ${kind}`);
}

test('sends the key only in the x-goog-api-key header, with temperature 0.2 and thinking off', async () => {
  const { fetch, calls } = mockFetch((c) => okTranslation(c));
  const s = new GeminiService(async () => KEY, fetch);
  const r = await s.translate({ text: 'תתקן את `foo()`', direction: 'he-en', model: 'gemini-2.5-flash-lite' });
  assert.equal(r.text, 'word word `foo()`');
  const c = calls[0]!;
  assert.equal(c.headers['x-goog-api-key'], KEY);
  assert.ok(!c.url.includes(KEY));
  assert.equal(c.url, `${API_BASE}/models/gemini-2.5-flash-lite:generateContent`);
  const body = JSON.parse(c.body!) as Record<string, any>;
  assert.equal(body.generationConfig.temperature, 0.2);
  assert.deepEqual(body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.ok(!c.body!.includes('foo()'), 'inline code is not sent');
  assert.match(body.systemInstruction.parts[0].text, /coding agent/);
  assert.match(body.systemInstruction.parts[0].text, /Never answer/);
});

test('Gemini 3 models use thinkingLevel minimal; a rejected thinking config is retried without it', async () => {
  const { fetch, calls } = mockFetch((c, n) =>
    n === 1 ? { status: 400, body: { error: { code: 400, message: 'Thinking level is not supported for this model.', status: 'INVALID_ARGUMENT' } } } : okTranslation(c),
  );
  const s = new GeminiService(async () => KEY, fetch);
  await s.translate({ text: 'שלום', direction: 'he-en', model: 'gemini-3-flash-lite' });
  assert.deepEqual((JSON.parse(calls[0]!.body!) as any).generationConfig.thinkingConfig, { thinkingLevel: 'minimal' });
  assert.equal((JSON.parse(calls[1]!.body!) as any).generationConfig.thinkingConfig, undefined);
});

test('code-only text is not sent at all', async () => {
  const { fetch, calls } = mockFetch((c) => okTranslation(c));
  const s = new GeminiService(async () => KEY, fetch);
  const r = await s.translate({ text: '```\nx\n```', direction: 'he-en', model: 'm' });
  assert.equal(calls.length, 0);
  assert.equal(r.sent, false);
});

test('in-memory cache keyed by text, direction and model', async () => {
  const { fetch, calls } = mockFetch((c) => okTranslation(c));
  const s = new GeminiService(async () => KEY, fetch);
  const req = { text: 'שלום עולם', direction: 'he-en' as const, model: 'gemini-2.5-flash-lite' };
  await s.translate(req);
  const second = await s.translate(req);
  assert.equal(second.fromCache, true);
  assert.equal(calls.length, 1);
  await s.translate({ ...req, model: 'gemini-2.5-flash' });
  await s.translate({ ...req, direction: 'en-he' });
  assert.equal(calls.length, 3);
});

test('preserves leading and trailing whitespace', async () => {
  const { fetch } = mockFetch(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: '  Hello\n' }] }, finishReason: 'STOP' }] } }));
  const s = new GeminiService(async () => KEY, fetch);
  const r = await s.translate({ text: '\nשלום\n\n', direction: 'he-en', model: 'm' });
  assert.equal(r.text, '\nHello\n\n');
});

test('missing key', async () => {
  const { fetch } = mockFetch((c) => okTranslation(c));
  await expectError(new GeminiService(async () => undefined, fetch).translate({ text: 'שלום', direction: 'he-en', model: 'm' }), 'missingKey');
  await expectError(new GeminiService(async () => '  ', fetch).translate({ text: 'שלום', direction: 'he-en', model: 'm' }), 'missingKey');
});

test('invalid key', async () => {
  const { fetch } = mockFetch(() => ({
    status: 400,
    body: { error: { code: 400, message: `API key not valid. Please pass a valid API key. ${KEY}`, status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } },
  }));
  await expectError(new GeminiService(async () => KEY, fetch).translate({ text: 'שלום', direction: 'he-en', model: 'm' }), 'invalidKey');
});

test('429 per-minute: "try again in X seconds" from RetryInfo', async () => {
  const { fetch } = mockFetch(() => ({
    status: 429,
    body: {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded',
        details: [
          { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] },
          { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37.2s' },
        ],
      },
    },
  }));
  const e = await expectError(new GeminiService(async () => KEY, fetch).translate({ text: 'שלום', direction: 'he-en', model: 'm' }), 'rateLimitMinute');
  assert.equal(e.details.retryAfterSec, 38);
  assert.match(e.message, /נסי שוב בעוד 38 שניות/);
});

test('429 daily quota: reset time shown in Israel time, no retry, no model switch', async () => {
  const { fetch, calls } = mockFetch(() => ({
    status: 429,
    body: {
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'Quota exceeded',
        details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }, { retryDelay: '20s' }],
      },
    },
  }));
  const now = new Date('2026-11-19T12:00:00Z'); // 04:00 in Los Angeles (PST, UTC-8)
  const e = await expectError(new GeminiService(async () => KEY, fetch, () => now).translate({ text: 'שלום', direction: 'he-en', model: 'm' }), 'quotaDaily');
  assert.equal(e.details.resetAt?.toISOString(), '2026-11-20T08:00:00.000Z'); // midnight PST
  assert.match(e.message, /20\.11 בשעה 10:00/); // 10:00 Israel (UTC+2)
  assert.equal(calls.length, 1);
});

test('Pacific midnight handles daylight saving time', () => {
  assert.equal(nextPacificMidnight(new Date('2026-07-01T20:00:00Z')).toISOString(), '2026-07-02T07:00:00.000Z');
  // Day DST ends in the US (Nov 1, 2026): midnight after it is PST.
  assert.equal(nextPacificMidnight(new Date('2026-11-01T10:00:00Z')).toISOString(), '2026-11-02T08:00:00.000Z');
  assert.equal(formatIsraelTime(new Date('2026-07-02T07:00:00Z')), '2.7 בשעה 10:00');
});

test('Pacific quota day key', () => {
  assert.equal(pacificDateKey(new Date('2026-11-20T07:59:00Z')), '2026-11-19'); // 23:59 PST
  assert.equal(pacificDateKey(new Date('2026-11-20T08:00:00Z')), '2026-11-20'); // midnight PST
});

test('pickModel reports when no stable model of the tier exists', async () => {
  const { fetch } = mockFetch(() => ({ status: 200, body: { models: [{ name: 'models/gemini-3.1-flash-lite-preview', supportedGenerationMethods: ['generateContent'] }] } }));
  const e = await expectError(new GeminiService(async () => KEY, fetch).pickModel('flash-lite'), 'modelUnavailable');
  assert.match(e.message, /Flash-Lite/);
});

test('bidi control marks are removed from English output, code keeps them', async () => {
  const rlm = String.fromCharCode(0x200f);
  const { fetch } = mockFetch(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: `${rlm}Run ⟦P1⟧${rlm}` }] }, finishReason: 'STOP' }] } }));
  const code = '`echo ' + rlm + 'x`';
  const r = await new GeminiService(async () => KEY, fetch).translate({ text: `תריץ ${code}`, direction: 'he-en', model: 'm' });
  assert.equal(r.text, `Run ${code}`);
});

test('one retry on transient network error, then success', async () => {
  const { fetch, calls } = mockFetch((c, n) => (n === 1 ? new TypeError('fetch failed') : okTranslation(c)));
  const r = await new GeminiService(async () => KEY, fetch).translate({ text: 'שלום', direction: 'he-en', model: 'm' });
  assert.equal(r.text, 'word');
  assert.equal(calls.length, 2);
});

test('network error twice gives "translation failed", only two attempts', async () => {
  const { fetch, calls } = mockFetch(() => new TypeError('fetch failed'));
  const e = await expectError(new GeminiService(async () => KEY, fetch).translate({ text: 'שלום', direction: 'he-en', model: 'm' }), 'network');
  assert.match(e.message, /התרגום נכשל/);
  assert.equal(calls.length, 2);
});

test('HTTP errors are not retried', async () => {
  const { fetch, calls } = mockFetch(() => ({ status: 500, body: { error: { code: 500, message: 'internal' } } }));
  await expectError(new GeminiService(async () => KEY, fetch).translate({ text: 'שלום', direction: 'he-en', model: 'm' }), 'badResponse');
  assert.equal(calls.length, 1);
});

test('timeout', async () => {
  const { fetch, calls } = mockFetch(() => 'hang');
  await expectError(new GeminiService(async () => KEY, fetch, undefined, 30).translate({ text: 'שלום', direction: 'he-en', model: 'm' }), 'timeout');
  assert.equal(calls.length, 1);
});

test('malformed and blocked responses', async () => {
  const cases: Array<[unknown, string]> = [
    ['not json', 'badResponse'],
    [{ candidates: [] }, 'badResponse'],
    [{ candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }] }, 'badResponse'],
    [{ candidates: [{ content: { parts: [{ text: 'half' }] }, finishReason: 'MAX_TOKENS' }] }, 'badResponse'],
    [{ promptFeedback: { blockReason: 'SAFETY' } }, 'blocked'],
    [{ candidates: [{ finishReason: 'SAFETY' }] }, 'blocked'],
  ];
  for (const [body, kind] of cases) {
    const { fetch } = mockFetch(() => ({ status: 200, body }));
    await expectError(new GeminiService(async () => KEY, fetch).translate({ text: 'שלום', direction: 'he-en', model: 'm' }), kind);
  }
});

test('model output that drops or duplicates a placeholder is rejected and not cached', async () => {
  for (const out of ['Run it', 'Run ⟦P1⟧ ⟦P1⟧', 'Run ⟦P 1⟧']) {
    const { fetch, calls } = mockFetch(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: out }] }, finishReason: 'STOP' }] } }));
    const s = new GeminiService(async () => KEY, fetch);
    const e = await expectError(s.translate({ text: 'תריץ `npm test`', direction: 'he-en', model: 'm' }), 'placeholders');
    assert.match(e.message, /התרגום שינה קוד, בוטל/);
    await expectError(s.translate({ text: 'תריץ `npm test`', direction: 'he-en', model: 'm' }), 'placeholders');
    assert.equal(calls.length, 2, 'failed output was not cached');
  }
});

test('listModels + pickModel use the header, follow pages and pick the newest stable Flash-Lite', async () => {
  const { fetch, calls } = mockFetch((c) => {
    if (!c.url.includes('pageToken')) {
      return { status: 200, body: { models: [{ name: 'models/gemini-2.0-flash-lite', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'p2' } };
    }
    return {
      status: 200,
      body: {
        models: [
          { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.1-flash-lite-preview', supportedGenerationMethods: ['generateContent'] },
        ],
      },
    };
  });
  const s = new GeminiService(async () => undefined, fetch);
  assert.equal(await s.pickModel('flash-lite', KEY), 'gemini-2.5-flash-lite');
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.equal(c.headers['x-goog-api-key'], KEY);
    assert.ok(!c.url.includes(KEY));
  }
});

test('pickModel with an invalid key', async () => {
  const { fetch } = mockFetch(() => ({ status: 400, body: { error: { code: 400, message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } } }));
  await expectError(new GeminiService(async () => undefined, fetch).pickModel('flash-lite', KEY), 'invalidKey');
});
