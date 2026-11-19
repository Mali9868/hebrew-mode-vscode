// Test harness only. Replaces fetch for the Gemini host with canned answers driven by a mode file,
// logs every request (to check what would have been sent), and stands in for claude-vscode.focus.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const DIR = process.env.HEBREW_MODE_E2E_DIR || '/tmp/hebrew-mode-e2e';
const MODE_FILE = path.join(DIR, 'mode.txt');
const LOG_FILE = path.join(DIR, 'harness-log.json');
const log = { focus: 0, requests: [] };
const save = () => fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
const mode = () => {
  try {
    return fs.readFileSync(MODE_FILE, 'utf8').trim() || 'ok';
  } catch {
    return 'ok';
  }
};
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Canned translations for the two sample texts used by the e2e run. Placeholders are copied in order.
const SAMPLES = [
  { match: /תוסיף בדיקות יחידה/u, out: 'Add unit tests for the {0} function in {1}, then run {2}. Do not change this code:\n\n{3}' },
  { match: /המפתח לבדיקה/u, out: 'Check that the key {0} works.' },
  { match: /I added three tests/, out: 'הוספתי שלוש בדיקות ל-{0}. כולן עוברות:\n\n{1}\n\nבהמשך כדאי לטפל במקרה ש-{2} ריק.' },
];

function fakeTranslate(text, toEnglish) {
  const placeholders = text.match(/⟦P\d+⟧/g) || [];
  for (const s of SAMPLES) {
    if (s.match.test(text)) return s.out.replace(/\{(\d+)\}/g, (_, i) => placeholders[Number(i)] || '');
  }
  return toEnglish ? text.replace(/\p{Script=Hebrew}+/gu, 'word') : text.replace(/(?<!⟦)[A-Za-z]+/g, 'מילה');
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, init);
  const headers = init.headers || {};
  log.requests.push({ url: u, method: init.method, keyHeader: headers['x-goog-api-key'] || null, body: init.body || null, mode: mode() });
  save();
  const m = mode();
  if (m === 'invalid-key') {
    return json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } });
  }
  if (u.includes('/models?')) {
    return json(200, {
      models: [
        { name: 'models/gemini-2.0-flash-lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.1-flash-lite-preview', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      ],
    });
  }
  if (m === '429') {
    return json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }, { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }] } });
  }
  if (m === 'daily') {
    return json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
  }
  if (m === 'network') throw new TypeError('fetch failed');
  if (m === 'bad') return json(200, { candidates: [] });
  const body = JSON.parse(init.body);
  const text = body.contents[0].parts[0].text;
  const toEnglish = /Translate from Hebrew to English/.test(body.systemInstruction.parts[0].text);
  let out = fakeTranslate(text, toEnglish);
  if (m === 'drop') out = out.replace(/⟦P1⟧/, '');
  return json(200, { candidates: [{ content: { parts: [{ text: out }] }, finishReason: 'STOP' }] });
};

function activate(context) {
  fs.mkdirSync(DIR, { recursive: true });
  save();
  // Without this stand-in the extension must fall back to "click the Claude field and paste".
  if (process.env.HEBREW_MODE_E2E_NO_FOCUS === '1') return;
  context.subscriptions.push(
    vscode.commands.registerCommand('claude-vscode.focus', () => {
      log.focus++;
      save();
    }),
  );
}

module.exports = { activate };
