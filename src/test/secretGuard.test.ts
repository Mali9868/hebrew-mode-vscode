import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanSecrets } from '../core/secretGuard';

// Test fixtures are assembled at runtime so no real-looking secret is committed as one string.
const g = 'AIza' + 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r'.slice(0, 35);
const aws = 'AKIA' + 'IOSFODNN7EXAMPLE';
const gh = 'ghp_' + 'a'.repeat(20) + 'B'.repeat(16);
const jwt = 'eyJhbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIn0' + '.' + 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

test('detects common API keys with line numbers and masked preview', () => {
  const text = `שורה ראשונה\nהמפתח שלי ${g} תודה\nוגם ${aws}\nוגם ${gh}`;
  const f = scanSecrets(text);
  assert.deepEqual(f.map((x) => [x.type, x.line]), [
    ['Google API key', 2],
    ['AWS access key', 3],
    ['GitHub token', 4],
  ]);
  for (const x of f) {
    assert.ok(!x.preview.includes(text.slice(x.start + 4, x.end)), 'preview does not reveal the secret');
    assert.equal(text.slice(x.start, x.end).slice(0, 4), x.preview.slice(0, 4));
  }
});

test('detects JWTs', () => {
  const f = scanSecrets(`הטוקן: ${jwt}`);
  assert.equal(f[0]?.type, 'JWT');
});

test('detects private key blocks', () => {
  const pem = '-----BEGIN ' + 'RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----';
  const f = scanSecrets(`הנה:\n${pem}\nסוף`);
  assert.equal(f.length, 1);
  assert.equal(f[0]?.type, 'Private key');
  assert.equal(f[0]?.line, 2);
  assert.ok(f[0]?.preview.startsWith('-----BEGIN'));
});

test('detects KEY=value env lines', () => {
  const text = ['DATABASE_URL=postgres://u:hunter22@db:5432/x', 'API_KEY="s3cr3tvalue"', 'export STRIPE_SECRET=abcdef123456', 'RANDOM_ID=aB3dE5gH7jK9mN1pQ3sT5v'].join('\n');
  const f = scanSecrets(text);
  assert.deepEqual(f.map((x) => x.line), [1, 2, 3, 4]);
});

test('ignores harmless env lines and placeholders', () => {
  const text = ['NODE_ENV=production', 'PORT=3000', 'API_KEY=<your-key>', 'API_KEY=your_api_key_here', 'TOKEN=${TOKEN}', 'DEBUG=true', 'API_KEY=xxxx'].join('\n');
  assert.deepEqual(scanSecrets(text), []);
});

test('ignores ordinary Hebrew and English prose', () => {
  assert.deepEqual(scanSecrets('תכתוב פונקציה שמאמתת key=value בקובץ הגדרות. The password field must be hidden.'), []);
});

test('skips secrets inside fenced code blocks (they are never sent)', () => {
  const text = `תסביר:\n\`\`\`\nconst k = "${g}";\n\`\`\``;
  assert.deepEqual(scanSecrets(text), []);
});

test('detects passwords in connection strings and bearer tokens', () => {
  const f = scanSecrets('התחבר עם mongodb://admin:Pa55word@host/db וגם Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456');
  assert.deepEqual(f.map((x) => x.type), ['Password in URL', 'Bearer token']);
});
