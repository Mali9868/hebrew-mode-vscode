/**
 * Static checks for the hard rules, run over the source tree:
 * no em dashes in user-facing text, the key only in the x-goog-api-key header,
 * no Claude Code command other than claude-vscode.focus, no disk writes,
 * no telemetry or logging.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SKIP = new Set(['node_modules', 'out', '.git']);

function files(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, exts));
    else if (exts.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const productionSources = files(join(ROOT, 'src'), ['.ts']).filter((f) => !f.includes(`${join('src', 'test')}`));

test('no em dashes in any shipped or documented text', () => {
  const emDash = String.fromCharCode(0x2014);
  const targets = [...files(ROOT, ['.ts', '.md', '.json']), join(ROOT, 'LICENSE')].filter((f) => existsSync(f));
  const offenders = targets.filter((f) => readFileSync(f, 'utf8').includes(emDash)).map((f) => relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

test('the API key is sent only in the x-goog-api-key header, never in a URL', () => {
  const all = productionSources.map((f) => readFileSync(f, 'utf8')).join('\n');
  assert.ok(/'x-goog-api-key': key/.test(all));
  assert.ok(!/[?&]key=/.test(all), 'no ?key= query parameter anywhere');
});

test('the only Claude Code command used is claude-vscode.focus', () => {
  const all = productionSources.map((f) => readFileSync(f, 'utf8')).join('\n');
  const used = new Set(all.match(/claude-vscode\.[A-Za-z]+(?:\.[A-Za-z]+)*/g) ?? []);
  assert.deepEqual([...used], ['claude-vscode.focus']);
});

test('no disk writes, no logging, no telemetry in production code', () => {
  for (const f of productionSources) {
    const src = readFileSync(f, 'utf8');
    const name = relative(ROOT, f);
    assert.ok(!/writeFile|appendFile|createWriteStream|fs\.write/.test(src), `${name} writes files`);
    assert.ok(!/console\.(log|info|warn|error|debug)\s*\(/.test(src), `${name} logs`);
    assert.ok(!/createOutputChannel|telemetry|TelemetryLogger/i.test(src), `${name} has logging or telemetry`);
  }
});

test('the only network host is the Gemini API', () => {
  const all = productionSources.map((f) => readFileSync(f, 'utf8')).join('\n');
  const hosts = new Set((all.match(/https:\/\/[A-Za-z0-9.-]+/g) ?? []).map((u) => u.replace('https://', '')));
  hosts.delete('aistudio.google.com'); // opened in the browser for the user, not called
  assert.deepEqual([...hosts], ['generativelanguage.googleapis.com']);
});

test('the API key is stored only in SecretStorage, with the env var as fallback', () => {
  const ext = readFileSync(join(ROOT, 'src', 'extension.ts'), 'utf8');
  assert.ok(ext.includes('this.ctx.secrets.store(SECRET_KEY, key)'));
  assert.ok(ext.includes("'HEBREW_MODE_GEMINI_KEY'"));
  assert.ok(!/globalState\.update\([^)]*key/i.test(ext.replace(/globalState\.update\(key, value\)/, '')));
});
