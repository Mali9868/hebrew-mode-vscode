/**
 * Flow tests for the four commands, one test (or more) per row of the
 * SPEC.md failure table. The fake host records every side effect; Gemini is
 * a mocked fetch. After every failure the clipboard must hold the original.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLAUDE_FOCUS_COMMAND, Config, HebrewModeApp, Host, STATE_COUNTER, STATE_MODEL, STATE_PRIVACY, parseGlossaryFile } from '../core/app';
import { FetchLike, GeminiService } from '../core/geminiService';
import { KEY_URL, MESSAGES } from '../core/messages';

const KEY = 'TEST-KEY-abcdefghijklmnop';
const HEBREW = 'תוסיף בדיקות לקובץ src/app.ts ותריץ `npm test`';

interface Call {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

type Reply = { status: number; body: unknown } | Error;

class FakeHost implements Host {
  clipboard = '';
  key: string | undefined = KEY;
  state = new Map<string, unknown>([[STATE_PRIVACY, true]]);
  cfg: Config = { enabled: true, tier: 'flash-lite', modelOverride: '', glossary: [] };
  focusExists = true;
  /** Values the next askApiKey() calls return (undefined = cancelled). */
  keyAnswers: Array<string | undefined> = [];
  /** Answers for confirm(), by order. */
  confirmAnswers: boolean[] = [];
  /** Action the next warn() resolves with. */
  warnAction: string | undefined;
  /** Runs while a translation is in progress (to simulate the user copying). */
  duringProgress: (() => void) | undefined;

  log: string[] = [];
  infos: string[] = [];
  warnings: string[] = [];
  errors: string[] = [];
  statuses: string[] = [];
  confirms: Array<{ kind: string; message: string; detail: string }> = [];
  panels: string[] = [];
  opened: string[] = [];
  focusCalls = 0;
  countChanges: number[] = [];

  async readClipboard(): Promise<string> {
    return this.clipboard;
  }
  async writeClipboard(text: string): Promise<void> {
    this.log.push('writeClipboard');
    this.clipboard = text;
  }
  async info(message: string): Promise<string | undefined> {
    this.infos.push(message);
    return undefined;
  }
  async warn(message: string): Promise<string | undefined> {
    this.warnings.push(message);
    return this.warnAction;
  }
  async error(message: string): Promise<string | undefined> {
    this.errors.push(message);
    return undefined;
  }
  status(message: string): void {
    this.statuses.push(message);
  }
  async confirm(kind: 'warning' | 'info', message: string, detail: string): Promise<boolean> {
    this.confirms.push({ kind, message, detail });
    return this.confirmAnswers.shift() ?? false;
  }
  async progress<T>(_title: string, task: () => Promise<T>): Promise<T> {
    const p = task();
    this.duringProgress?.();
    return p;
  }
  showPanel(hebrew: string): void {
    this.panels.push(hebrew);
  }
  async focusClaude(): Promise<boolean> {
    this.focusCalls++;
    this.log.push(`focus:${CLAUDE_FOCUS_COMMAND}`);
    return this.focusExists;
  }
  async openExternal(url: string): Promise<void> {
    this.opened.push(url);
  }
  async askApiKey(): Promise<string | undefined> {
    this.log.push('askApiKey');
    return this.keyAnswers.shift();
  }
  async getKey(): Promise<string | undefined> {
    return this.key;
  }
  async storeKey(key: string): Promise<void> {
    this.key = key;
  }
  getState<T>(key: string): T | undefined {
    return this.state.get(key) as T | undefined;
  }
  async setState(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.state.delete(key);
    else this.state.set(key, value);
  }
  async config(): Promise<Config> {
    return this.cfg;
  }
  now(): Date {
    return new Date('2026-11-19T12:00:00Z');
  }
  countChanged(count: number): void {
    this.countChanges.push(count);
  }
}

const MODELS = { models: [{ name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] }] };

/** Gemini mock: model list + an echo translator; `reply` can override generateContent answers. */
function gemini(host: FakeHost, reply?: (call: Call, n: number) => Reply | undefined): { service: GeminiService; calls: Call[] } {
  const calls: Call[] = [];
  let generateCount = 0;
  const fetch: FetchLike = async (url, init) => {
    const call: Call = { url, headers: init.headers, body: init.body };
    calls.push(call);
    if (init.headers['x-goog-api-key'] !== 'VALID' && init.headers['x-goog-api-key'] !== KEY) {
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: { code: 400, message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }) };
    }
    if (url.includes('/models?')) return { ok: true, status: 200, text: async () => JSON.stringify(MODELS) };
    generateCount++;
    const custom = reply?.(call, generateCount);
    if (custom instanceof Error) throw custom;
    if (custom) return { ok: custom.status < 300, status: custom.status, text: async () => JSON.stringify(custom.body) };
    const sent = (JSON.parse(init.body ?? '{}') as { contents: Array<{ parts: Array<{ text: string }> }> }).contents[0]?.parts[0]?.text ?? '';
    const out = /[\u05D0-\u05EA]/.test(sent) ? sent.replace(/[\u05D0-\u05EA]+/g, 'en') : sent.replace(/(?<!⟦)[A-Za-z]+/g, 'עב');
    return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: out }] }, finishReason: 'STOP' }] }) };
  };
  return { service: new GeminiService(() => host.getKey(), fetch), calls };
}

function setup(reply?: (call: Call, n: number) => Reply | undefined) {
  const host = new FakeHost();
  const g = gemini(host, reply);
  const app = new HebrewModeApp(host, g.service);
  return { host, app, calls: g.calls, generateCalls: () => g.calls.filter((c) => c.url.includes(':generateContent')) };
}

const generateError = (status: number, error: unknown) => () => ({ status, body: { error } });

// ---------------------------------------------------------------------------
// Happy paths

test('Ctrl+Alt+E: English goes to the clipboard, the Hebrew draft is kept, Claude is focused', async () => {
  const { host, app, generateCalls } = setup();
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  assert.equal(host.clipboard, 'en en en ⟦P1⟧ en `npm test`'.replace('⟦P1⟧', 'src/app.ts'));
  assert.equal(host.focusCalls, 1);
  assert.deepEqual(host.statuses, [MESSAGES.englishReady]);
  assert.equal(generateCalls().length, 1);
  assert.ok(!generateCalls()[0]!.body!.includes('npm test'), 'inline code not sent');
  assert.deepEqual(host.countChanges, [1]);
  assert.deepEqual(host.state.get(STATE_COUNTER), { day: '2026-11-19', count: 1 });

  await app.restoreHebrew();
  assert.equal(host.clipboard, HEBREW, 'Ctrl+Alt+Z restores the Hebrew draft');
});

test('Ctrl+Alt+H: Hebrew shown in the panel, clipboard untouched', async () => {
  const { host, app } = setup();
  host.clipboard = 'Run the tests in `src/app.ts`.';
  await app.translateToHebrew();
  assert.equal(host.clipboard, 'Run the tests in `src/app.ts`.');
  assert.deepEqual(host.panels, ['עב עב עב עב `src/app.ts`.']);
  assert.ok(!host.log.includes('writeClipboard'));
  assert.equal(host.focusCalls, 0);
});

test('Ctrl+Alt+E on English text shows it in Hebrew instead (one shortcut, both directions)', async () => {
  const { host, app } = setup();
  host.clipboard = 'All tests pass now.';
  await app.translateToEnglish();
  assert.deepEqual(host.panels, ['עב עב עב עב.']);
  assert.equal(host.clipboard, 'All tests pass now.');
  assert.deepEqual(host.statuses, [MESSAGES.routedToHebrew]);
});

test('Ctrl+Alt+H on Hebrew text does nothing and explains', async () => {
  const { host, app, calls } = setup();
  host.clipboard = HEBREW;
  await app.translateToHebrew();
  assert.deepEqual(host.infos, [MESSAGES.alreadyHebrew]);
  assert.equal(calls.length, 0);
});

test('nothing is ever sent to Claude: the only Claude touch point is the focus command', async () => {
  const { host, app } = setup();
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  assert.deepEqual(host.log, ['writeClipboard', `focus:${CLAUDE_FOCUS_COMMAND}`]);
});

// ---------------------------------------------------------------------------
// Failure table (SPEC.md), one block per row

test('row 1a: missing key opens Set API Key; cancelling leaves the clipboard as is', async () => {
  const { host, app, calls } = setup();
  host.key = undefined;
  host.clipboard = HEBREW;
  host.keyAnswers = [undefined];
  await app.translateToEnglish();
  assert.deepEqual(host.opened, [KEY_URL]);
  assert.ok(host.log.includes('askApiKey'));
  assert.ok(host.warnings.includes(MESSAGES.missingKey));
  assert.equal(host.clipboard, HEBREW);
  assert.equal(calls.length, 0);
});

test('row 1b: missing key, then a valid key is entered: translation continues', async () => {
  const { host, app } = setup();
  host.key = undefined;
  host.clipboard = HEBREW;
  host.keyAnswers = ['  VALID  '];
  await app.translateToEnglish();
  assert.equal(host.key, 'VALID', 'stored trimmed');
  assert.deepEqual(host.state.get(STATE_MODEL), { tier: 'flash-lite', model: 'gemini-2.5-flash-lite' });
  assert.notEqual(host.clipboard, HEBREW);
  assert.equal(host.focusCalls, 1);
});

test('row 1c: invalid key (for example from the env var) opens setup; clipboard kept on cancel', async () => {
  const { host, app } = setup();
  host.key = 'WRONG';
  host.state.set(STATE_MODEL, { tier: 'flash-lite', model: 'gemini-2.5-flash-lite' });
  host.clipboard = HEBREW;
  host.keyAnswers = [undefined];
  await app.translateToEnglish();
  assert.ok(host.warnings.includes(MESSAGES.invalidKey));
  assert.deepEqual(host.opened, [KEY_URL]);
  assert.equal(host.clipboard, HEBREW);
});

test('row 2: empty clipboard shows "copy the text first" and sends nothing', async () => {
  for (const empty of ['', '   \n\t ']) {
    const { host, app, calls } = setup();
    host.clipboard = empty;
    await app.translateToEnglish();
    await app.translateToHebrew();
    assert.deepEqual(host.infos, [MESSAGES.emptyClipboard, MESSAGES.emptyClipboard]);
    assert.equal(host.infos[0], 'העתיקי קודם את הטקסט');
    assert.equal(calls.length, 0);
    assert.equal(host.clipboard, empty);
  }
});

test('row 3: per-minute limit (429) says "try again in X seconds"; clipboard kept', async () => {
  const { host, app } = setup(
    generateError(429, {
      code: 429,
      status: 'RESOURCE_EXHAUSTED',
      details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { retryDelay: '12s' }],
    }),
  );
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  assert.deepEqual(host.warnings, ['הגעת למגבלת הבקשות לדקה. נסי שוב בעוד 12 שניות.']);
  assert.equal(host.clipboard, HEBREW);
  assert.equal(host.focusCalls, 0);
});

test('row 4: daily quota says when it renews in Israel time; no retry, no other model', async () => {
  const { host, app, generateCalls } = setup(
    generateError(429, { code: 429, details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] }),
  );
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  assert.equal(host.warnings.length, 1);
  assert.match(host.warnings[0]!, /מתחדשת ב-20\.11 בשעה 10:00 שעון ישראל/);
  assert.equal(generateCalls().length, 1);
  assert.equal(host.clipboard, HEBREW);
});

test('row 5: network failure or a malformed answer says "translation failed"; clipboard kept', async () => {
  const replies: Array<(c: Call, n: number) => Reply> = [
    () => new TypeError('fetch failed'),
    () => ({ status: 200, body: { candidates: [] } }),
    () => ({ status: 500, body: { error: { code: 500 } } }),
  ];
  for (const reply of replies) {
    const { host, app } = setup(reply);
    host.clipboard = HEBREW;
    await app.translateToEnglish();
    assert.deepEqual(host.errors, [MESSAGES.failed]);
    assert.match(host.errors[0]!, /^התרגום נכשל/);
    assert.equal(host.clipboard, HEBREW);
  }
});

test('row 6: a missing or altered placeholder says "the translation changed code, cancelled"', async () => {
  for (const out of ['Add tests and run it', 'Add tests to ⟦P1⟧ ⟦P1⟧ and run ⟦P2⟧', 'Add ⟦P 1⟧ ⟦P2⟧']) {
    const { host, app } = setup(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: out }] }, finishReason: 'STOP' }] } }));
    host.clipboard = HEBREW;
    await app.translateToEnglish();
    assert.deepEqual(host.errors, [MESSAGES.placeholders]);
    assert.match(host.errors[0]!, /^התרגום שינה קוד, בוטל/);
    assert.equal(host.clipboard, HEBREW);
  }
});

test('row 7a: a secret blocks the request, shows the line, and cancelling sends nothing', async () => {
  const { host, app, calls } = setup();
  const secret = 'AIza' + 'Sy'.padEnd(35, 'x7Q');
  host.clipboard = `שורה ראשונה\nהמפתח הוא ${secret} ותבדוק אותו`;
  host.confirmAnswers = [false];
  await app.translateToEnglish();
  assert.equal(host.confirms.length, 1);
  assert.equal(host.confirms[0]!.message, MESSAGES.secretFound);
  assert.match(host.confirms[0]!.detail, /שורה 2: Google API key/);
  assert.ok(!host.confirms[0]!.detail.includes(secret), 'the dialog does not show the secret');
  assert.equal(calls.length, 0);
  assert.equal(host.clipboard, `שורה ראשונה\nהמפתח הוא ${secret} ותבדוק אותו`);
});

test('row 7b: "Mask and translate" keeps the secret out of the request and restores it', async () => {
  const { host, app, generateCalls } = setup();
  const secret = 'AIza' + 'Sy'.padEnd(35, 'x7Q');
  host.clipboard = `המפתח הוא ${secret} ותבדוק אותו`;
  host.confirmAnswers = [true];
  await app.translateToEnglish();
  assert.equal(generateCalls().length, 1);
  assert.ok(!generateCalls()[0]!.body!.includes(secret));
  assert.ok(host.clipboard.includes(secret), 'secret restored in place');
  assert.ok(!/[\u05D0-\u05EA]/.test(host.clipboard));
});

test('row 8: without claude-vscode.focus the translation is still on the clipboard with a hint', async () => {
  const { host, app } = setup();
  host.focusExists = false;
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  assert.ok(!/[\u05D0-\u05EA]/.test(host.clipboard), 'English is on the clipboard');
  assert.deepEqual(host.infos, ['התרגום בלוח. לחצי על השדה של Claude והדביקי']);
});

// ---------------------------------------------------------------------------
// More "never lose text" cases

test('the clipboard is not overwritten if the user copied something else meanwhile', async () => {
  const { host, app } = setup();
  host.clipboard = HEBREW;
  host.duringProgress = () => {
    host.clipboard = 'משהו חדש שהעתקתי';
  };
  await app.translateToEnglish();
  assert.equal(host.clipboard, 'משהו חדש שהעתקתי');
  assert.deepEqual(host.warnings, [MESSAGES.clipboardChanged]);
  await app.restoreHebrew();
  assert.equal(host.clipboard, HEBREW, 'the draft is still restorable');
});

test('"copy the translation" from the clipboard-changed warning writes it on request', async () => {
  const { host, app } = setup();
  host.clipboard = HEBREW;
  host.warnAction = MESSAGES.copyTranslation;
  host.duringProgress = () => {
    host.clipboard = 'אחר';
  };
  await app.translateToEnglish();
  await new Promise((r) => setImmediate(r));
  assert.ok(!/[\u05D0-\u05EA]/.test(host.clipboard));
});

test('the Hebrew draft is kept even when the translation fails', async () => {
  const { host, app } = setup(() => new TypeError('offline'));
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  host.clipboard = 'something else';
  await app.restoreHebrew();
  assert.equal(host.clipboard, HEBREW);
});

test('restore without a draft explains how drafts are saved', async () => {
  const { host, app } = setup();
  host.clipboard = 'x';
  await app.restoreHebrew();
  assert.deepEqual(host.infos, [MESSAGES.noDraft]);
  assert.equal(host.clipboard, 'x');
});

test('code-only text is not sent at all', async () => {
  const { host, app, calls } = setup();
  host.clipboard = '```ts\nconst a = 1;\n```';
  await app.translateToEnglish();
  assert.deepEqual(host.infos, [MESSAGES.nothingToTranslate]);
  assert.equal(calls.length, 0);
});

test('workspace setting turns the extension off: nothing is read or sent', async () => {
  const { host, app, calls } = setup();
  host.cfg = { ...host.cfg, enabled: false };
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  await app.translateToHebrew();
  assert.deepEqual(host.infos, [MESSAGES.disabled, MESSAGES.disabled]);
  assert.equal(calls.length, 0);
});

test('privacy notice must be accepted before the first request', async () => {
  const { host, app, calls } = setup();
  host.state.delete(STATE_PRIVACY);
  host.clipboard = HEBREW;
  host.confirmAnswers = [false];
  await app.translateToEnglish();
  assert.equal(host.confirms[0]!.message, MESSAGES.privacyTitle);
  assert.equal(calls.length, 0);
  assert.equal(host.clipboard, HEBREW);

  host.confirmAnswers = [true];
  await app.translateToEnglish();
  assert.equal(host.state.get(STATE_PRIVACY), true);
  assert.notEqual(host.clipboard, HEBREW);
});

test('a second command while one is running is ignored, not queued', async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const { host, app } = setup();
  const realProgress = host.progress.bind(host);
  host.progress = async (title, task) => {
    await gate;
    return realProgress(title, task);
  };
  host.clipboard = HEBREW;
  const first = app.translateToEnglish();
  await app.translateToEnglish();
  assert.deepEqual(host.statuses, [MESSAGES.busy]);
  release();
  await first;
});

test('an unexpected bug shows a generic message and keeps the clipboard', async () => {
  const { host, app } = setup();
  host.clipboard = HEBREW;
  host.config = async () => {
    throw new Error('boom with details');
  };
  await app.translateToEnglish();
  assert.deepEqual(host.errors, [MESSAGES.unexpected]);
  assert.equal(host.clipboard, HEBREW);
});

// ---------------------------------------------------------------------------
// Set API Key

test('Set API Key: opens AI Studio, validates, picks a model, privacy on first run, then stores', async () => {
  const { host, app, calls } = setup();
  host.key = undefined;
  host.state.delete(STATE_PRIVACY);
  host.keyAnswers = ['VALID'];
  host.confirmAnswers = [true];
  assert.equal(await app.setApiKey(), true);
  assert.deepEqual(host.opened, ['https://aistudio.google.com/api-keys']);
  assert.equal(host.confirms[0]!.kind, 'info');
  assert.equal(host.key, 'VALID');
  assert.deepEqual(host.state.get(STATE_MODEL), { tier: 'flash-lite', model: 'gemini-2.5-flash-lite' });
  assert.deepEqual(host.infos, [MESSAGES.keySaved('gemini-2.5-flash-lite')]);
  assert.ok(calls.every((c) => !c.url.includes('VALID')), 'key never in the URL');
});

test('Set API Key: privacy declined means the key is not stored', async () => {
  const { host, app } = setup();
  host.key = undefined;
  host.state.delete(STATE_PRIVACY);
  host.keyAnswers = ['VALID'];
  host.confirmAnswers = [false];
  assert.equal(await app.setApiKey(), false);
  assert.equal(host.key, undefined);
  assert.deepEqual(host.infos, [MESSAGES.keyNotSavedPrivacy]);
});

test('Set API Key: an invalid key is rejected and not stored, and the message has no key', async () => {
  const { host, app } = setup();
  host.key = undefined;
  host.keyAnswers = ['WRONG-KEY-123'];
  assert.equal(await app.setApiKey(), false);
  assert.equal(host.key, undefined);
  assert.deepEqual(host.errors, [MESSAGES.keyInvalidSetup]);
  assert.ok(!host.errors[0]!.includes('WRONG-KEY-123'));
});

test('Set API Key: the Flash tier picks a Flash model; an override is respected at translation time', async () => {
  const { host, app, generateCalls } = setup();
  host.cfg = { ...host.cfg, modelOverride: 'models/gemini-custom-x' };
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  assert.match(generateCalls()[0]!.url, /\/models\/gemini-custom-x:generateContent$/);
});

test('a retired auto-picked model is re-picked once', async () => {
  const { host, app, generateCalls } = setup((_c, n) => (n === 1 ? { status: 404, body: { error: { code: 404, message: 'not found' } } } : undefined));
  host.state.set(STATE_MODEL, { tier: 'flash-lite', model: 'gemini-1.0-flash-lite' });
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  assert.equal(generateCalls().length, 2);
  assert.match(generateCalls()[1]!.url, /gemini-2\.5-flash-lite/);
  assert.notEqual(host.clipboard, HEBREW);
});

test('an unavailable override model gives a clear message', async () => {
  const { host, app } = setup(() => ({ status: 404, body: { error: { code: 404 } } }));
  host.cfg = { ...host.cfg, modelOverride: 'gemini-nope' };
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  assert.deepEqual(host.errors, [MESSAGES.overrideUnavailable('gemini-nope')]);
  assert.equal(host.clipboard, HEBREW);
});

test('glossary terms are not sent for translation', async () => {
  const { host, app, generateCalls } = setup();
  host.cfg = { ...host.cfg, glossary: ['Supabase'] };
  host.clipboard = 'תעשה migration ב-Supabase';
  await app.translateToEnglish();
  assert.ok(!generateCalls()[0]!.body!.includes('Supabase'));
  assert.ok(host.clipboard.includes('Supabase'));
});

test('project glossary file parsing', () => {
  assert.deepEqual(parseGlossaryFile('{ "glossary": ["deploy", " Supabase ", 3, ""] }'), ['deploy', 'Supabase']);
  assert.deepEqual(parseGlossaryFile(String.fromCharCode(0xfeff) + '{}'), []);
  assert.equal(parseGlossaryFile('{ "glossary": "deploy" }'), null);
  assert.equal(parseGlossaryFile('not json'), null);
  assert.equal(parseGlossaryFile('[]'), null);
});

test('daily counter counts only requests actually sent, per Pacific day', async () => {
  const { host, app } = setup();
  host.state.set(STATE_COUNTER, { day: '2026-11-18', count: 40 });
  assert.equal(app.todayCount, 0, 'yesterday does not count');
  host.clipboard = HEBREW;
  await app.translateToEnglish();
  host.clipboard = HEBREW;
  await app.translateToEnglish(); // cache hit, not sent
  assert.equal(app.todayCount, 1);
});

test('the missing-key warning has a button that opens the page where a key is created', async () => {
  const { host, app } = setup();
  host.key = undefined;
  host.clipboard = HEBREW;
  host.keyAnswers = [undefined];
  host.warnAction = MESSAGES.openKeyPage;
  await app.translateToEnglish();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(host.opened, [KEY_URL, KEY_URL], 'once by the setup itself, once by the button');
  assert.equal(host.clipboard, HEBREW);
});

test('the key input box shows where to create a key', () => {
  assert.match(MESSAGES.setupPrompt, /https:\/\/aistudio\.google\.com\/api-keys/);
});
