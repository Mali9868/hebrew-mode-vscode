import { test } from 'node:test';
import assert from 'node:assert/strict';
import { protect, restore, detectDirection, hebrewRatio, ProtectedItem } from '../core/contentProtector';

/** Simulates a perfect model: keeps placeholders, changes the prose. */
function fakeTranslate(s: string): string {
  return s.replace(/[\u05D0-\u05EA]+/g, 'word');
}

function originals(items: ProtectedItem[], kind?: string): string[] {
  return items.filter((i) => !kind || i.kind === kind).map((i) => i.original);
}

test('round trip without translation returns the exact input', () => {
  const input = 'תקן את הבאג ב-src/app.ts והרץ `npm test -- --watch`.\n\n```ts\nconst a = 1;\n```\nראה https://example.com/a?b=1.';
  const p = protect(input);
  const r = restore(p.text, p.items);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.text, input);
});

test('mixed Hebrew and English: technical tokens are protected, prose is not', () => {
  const input =
    'תוסיף קומפוננטה Button בקובץ src/components/Button.tsx, תריץ npm install --save-dev vitest, ותבדוק את @README.md ואת $HOME ו-HEBREW_MODE_GEMINI_KEY. פרטים ב-https://docs.example.com/x.';
  const p = protect(input);
  const all = originals(p.items);
  assert.ok(all.includes('src/components/Button.tsx'));
  assert.ok(all.includes('--save-dev'));
  assert.ok(all.includes('@README.md'));
  assert.ok(all.includes('$HOME'));
  assert.ok(all.includes('HEBREW_MODE_GEMINI_KEY'));
  assert.ok(all.includes('https://docs.example.com/x'), 'trailing dot is not part of the URL');
  assert.ok(p.text.includes('תוסיף קומפוננטה Button'), 'prose stays in the sent text');
  assert.ok(!p.onlyProtected);
  const r = restore(fakeTranslate(p.text), p.items);
  assert.ok(r.ok);
  for (const o of all) assert.ok(r.ok && r.text.includes(o), `restored ${o}`);
});

test('fenced code blocks are never in the sent text', () => {
  const secretCode = 'const SECRET_LOGIC = computeSomething(42);';
  const input = `תסביר מה הקוד עושה:\n\n\`\`\`js\n${secretCode}\nconsole.log("שלום");\n\`\`\`\n\nותציע שיפור.`;
  const p = protect(input);
  assert.ok(!p.text.includes('computeSomething'));
  assert.ok(!p.text.includes('console.log'));
  assert.ok(!p.text.includes('```'));
  assert.equal(p.items.filter((i) => i.kind === 'codeBlock').length, 1);
});

test('tilde fences, longer fences and unclosed fences are protected', () => {
  const input = 'א\n~~~py\nprint(1)\n~~~\nב\n````md\n```inner```\n````\nג\n```\nunclosed code';
  const p = protect(input);
  const blocks = originals(p.items, 'codeBlock');
  assert.equal(blocks.length, 3);
  assert.ok(blocks[1]?.includes('```inner```'));
  assert.ok(blocks[2]?.endsWith('unclosed code'));
  assert.ok(!p.text.includes('print(1)'));
});

test('nested Markdown: lists, indented code, links, tables, quotes', () => {
  const input = [
    '# כותרת',
    '',
    '1. שלב ראשון:',
    '   - תריץ `git status`',
    '   - ואז:',
    '',
    '     ```bash',
    '     git commit -m "fix"',
    '     ```',
    '2. **חשוב**: ראה [התיעוד](https://example.com/docs) ו-_הערות_.',
    '',
    '| עמודה | ערך |',
    '| --- | --- |',
    '| נתיב | ./config/app.json |',
    '',
    '> ציטוט עם `code` בתוכו',
  ].join('\n');
  const p = protect(input);
  assert.ok(!p.text.includes('git commit'), 'indented fenced block inside list is protected');
  assert.ok(originals(p.items, 'inlineCode').includes('`git status`'));
  assert.ok(originals(p.items, 'inlineCode').includes('`code`'));
  assert.ok(originals(p.items, 'url').includes('https://example.com/docs'), 'link URL protected, link text is not');
  assert.ok(p.text.includes('[התיעוד]('));
  assert.ok(originals(p.items, 'path').includes('./config/app.json'));
  assert.ok(p.text.includes('| עמודה | ערך |'), 'table structure is kept');
  const r = restore(fakeTranslate(p.text), p.items);
  assert.ok(r.ok);
  assert.ok(r.ok && r.text.includes('     git commit -m "fix"'));
});

test('RTL punctuation: Hebrew quotes, geresh, maqaf and sentence punctuation are not swallowed', () => {
  const input = 'מה זה צה״ל? תפתח את src/main.ts. אח״כ תריץ --help! ג׳אווה־סקריפט, "ציטוט" ו־(src/x.ts).';
  const p = protect(input);
  const all = originals(p.items);
  assert.ok(all.includes('src/main.ts'), 'trailing period not included');
  assert.ok(all.includes('--help'), 'trailing ! not included');
  assert.ok(all.includes('src/x.ts'), 'closing paren not included');
  assert.ok(p.text.includes('צה״ל?'));
  assert.ok(p.text.includes('אח״כ'));
  assert.ok(p.text.includes('ג׳אווה־סקריפט'));
  const r = restore(p.text, p.items);
  assert.ok(r.ok && r.text === input);
});

test('Hebrew prefix letters attached to technical tokens', () => {
  const input = 'תעדכן ב-package.json ובקובץ .env.local, ותמחק מ־dist/ הכל, וגם ב-src/app.ts ו-@src/a.ts ו-https://x.io.';
  const p = protect(input);
  const all = originals(p.items);
  assert.ok(all.includes('package.json'));
  assert.ok(all.includes('.env.local'));
  assert.ok(all.includes('dist/'));
  assert.ok(all.includes('src/app.ts'));
  assert.ok(all.includes('@src/a.ts'));
  assert.ok(all.includes('https://x.io'));
  assert.ok(p.text.includes('ב-⟦P1⟧'), 'the Hebrew prefix and hyphen stay in the prose');
});

test('plain prose has no false positives', () => {
  const input = 'תכתוב פונקציה שמחשבת ממוצע. היא צריכה לעבוד גם עם מערך ריק, למשל 1/2 או 19/11/2026.';
  const p = protect(input);
  assert.equal(p.items.length, 0);
  const en = protect('Write an e-mail parser and/or a well-known re-try helper.');
  assert.deepEqual(originals(en.items), ['and/or'], 'only and/or looks like a path, which is harmless');
});

test('emails and @mentions', () => {
  const p = protect('תשלח ל-dev@example.com ותתייג את @dan ואת @src/utils.ts');
  const all = originals(p.items);
  assert.ok(all.includes('dev@example.com'));
  assert.ok(all.includes('@dan'));
  assert.ok(all.includes('@src/utils.ts'));
});

test('glossary terms are protected case-insensitively as whole words', () => {
  const p = protect('תעשה deploy ל-Supabase ואל תיגע ב-supabase-js', { glossary: ['deploy', 'Supabase'] });
  const g = originals(p.items, 'glossary');
  assert.deepEqual(g, ['deploy', 'Supabase']);
  assert.ok(p.text.includes('supabase-js') || originals(p.items).includes('supabase-js'));
});

test('Hebrew glossary terms are protected too', () => {
  const p = protect('תעדכן את מסך הבית ואת מסך הביתי', { glossary: ['מסך הבית'] });
  assert.deepEqual(originals(p.items, 'glossary'), ['מסך הבית']);
});

test('literal placeholder-like text in the input cannot collide', () => {
  const input = 'הטקסט מכיל ⟦P1⟧ כבר, ו-⟧ בודד.';
  const p = protect(input);
  assert.equal(originals(p.items, 'literalPlaceholder').length, 2);
  const r = restore(p.text, p.items);
  assert.ok(r.ok && r.text === input);
});

test('extra spans (masked secrets) are protected', () => {
  const input = 'המפתח הוא abc123secret תודה';
  const start = input.indexOf('abc');
  const p = protect(input, { extraSpans: [{ start, end: start + 'abc123secret'.length }] });
  assert.ok(!p.text.includes('abc123secret'));
  assert.equal(originals(p.items, 'secret')[0], 'abc123secret');
});

test('onlyProtected is true when nothing is left to translate', () => {
  assert.equal(protect('```\ncode\n```').onlyProtected, true);
  assert.equal(protect('`x` src/a.ts --flag').onlyProtected, true);
  assert.equal(protect('שלום `x`').onlyProtected, false);
});

// --- model output that breaks placeholders ---

test('restore fails when the model drops a placeholder', () => {
  const p = protect('תריץ `npm test` ואז `npm run build`');
  const broken = p.text.replace('⟦P2⟧', '');
  const r = restore(broken, p.items);
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.reason === 'missing' && r.tokens.includes('⟦P2⟧'));
});

test('restore fails when the model duplicates a placeholder', () => {
  const p = protect('תריץ `npm test`');
  const r = restore(p.text + ' ⟦P1⟧', p.items);
  assert.ok(!r.ok && r.reason === 'duplicated');
});

test('restore fails when the model alters a placeholder', () => {
  const p = protect('תריץ `npm test`');
  for (const altered of ['Run ⟦ P1 ⟧', 'Run ⟦p1⟧', 'Run [[P1]] ⟦P1⟧', 'Run ⟦P1⟧ and ⟦P9⟧', 'Run ⟦P1⟧⟧']) {
    const r = restore(altered, p.items);
    assert.equal(r.ok, false, altered);
  }
});

test('restore accepts reordered placeholders (word order changes in translation)', () => {
  const p = protect('תעביר את `a` ל-`b`');
  const r = restore('Move ⟦P1⟧ to ⟦P2⟧'.replace('⟦P1⟧ to ⟦P2⟧', '⟦P1⟧ into ⟦P2⟧'), p.items);
  assert.ok(r.ok && r.text === 'Move `a` into `b`');
});

test('restore unwraps a code-block placeholder the model wrapped in a fence', () => {
  const p = protect('תסביר:\n```js\nx()\n```');
  const r = restore('Explain:\n```\n⟦P1⟧\n```', p.items);
  assert.ok(r.ok && r.text === 'Explain:\n```js\nx()\n```');
});

test('restore never re-expands tokens that appear inside restored content', () => {
  const p = protect('`a⟦P2⟧b` ו-`c`');
  const r = restore(p.text, p.items);
  assert.ok(r.ok && r.text === '`a⟦P2⟧b` ו-`c`');
});

// --- direction ---

test('direction detection uses the Hebrew share of prose only', () => {
  assert.equal(detectDirection('תקן את הבאג בקובץ src/very/long/path/to/some/file/name.ts'), 'he-en');
  assert.equal(detectDirection('Fix the bug. ```\nconst שלום = 1;\n```'), 'en-he');
  assert.equal(detectDirection('I fixed the bug in `src/app.ts`.'), 'en-he');
  assert.ok(hebrewRatio('שלום world') > 0.3);
});

test('code identifiers are protected: calls, members, camelCase, PascalCase, snake_case', () => {
  const input = 'תקרא ל-getUserById() ול-useState(0), תשתמש ב-console.log, ב-UserProfileCard, ב-HTMLElement ובשדה user_id.';
  const p = protect(input);
  // console.log is caught by the file-name rule (.log), which protects it just the same.
  assert.deepEqual(originals(p.items), ['getUserById()', 'useState(0)', 'console.log', 'UserProfileCard', 'HTMLElement', 'user_id']);
  const r = restore(p.text, p.items);
  assert.ok(r.ok && r.text === input);
});

test('identifier rules leave ordinary English words alone', () => {
  const p = protect('Please check the file(s) and APIs, IDs, e.g. the Button and the README.');
  const kinds = p.items.map((i) => `${i.kind}:${i.original}`);
  assert.deepEqual(kinds, ['path:README']);
});

test('Hebrew to English: command lines without backticks are protected whole', () => {
  const input = 'תריץ npm install --save-dev vitest ואז git push -u origin main, ובסוף sudo docker compose up.';
  const p = protect(input, { direction: 'he-en' });
  assert.deepEqual(
    p.items.filter((i) => i.kind === 'command').map((i) => i.original),
    ['npm install --save-dev vitest', 'git push -u origin main', 'sudo docker compose up'],
  );
  const r = restore(p.text, p.items);
  assert.ok(r.ok && r.text === input);
});

test('English to Hebrew: no command rule (English prose has no clear end), backticks still protect', () => {
  const p = protect('Run npm install to add the dependencies, then `git push`.', { direction: 'en-he' });
  assert.deepEqual(p.items.map((i) => i.original), ['`git push`']);
});

test('direction: short Hebrew instructions full of English terms still go to English', () => {
  assert.equal(detectDirection('תעשה migration ב-Supabase'), 'he-en');
  assert.equal(detectDirection('תעשה migration ב-Supabase', ['Supabase']), 'he-en');
  assert.equal(detectDirection('תריץ npm run build ותתקן errors'), 'he-en');
  assert.equal(detectDirection('תוסיף ל-component של ה-Header כפתור logout שמנקה את ה-session'), 'he-en');
});

test('direction: English answers that quote Hebrew strings stay English', () => {
  assert.equal(detectDirection("I changed the button label to 'שמור שינויים' in `Header.tsx`."), 'en-he');
  assert.equal(detectDirection('Done. The title is now "ברוכים הבאים" and the tests pass.'), 'en-he');
  assert.equal(detectDirection('All tests pass now.'), 'en-he');
});
