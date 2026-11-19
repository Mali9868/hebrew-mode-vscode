import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractGuide, isolateHebrewMarkdown } from '../tools/storeDocs';

const RLI = String.fromCharCode(0x2067);
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);

test('Hebrew paragraphs, headings and list items are isolated after their Markdown prefix', () => {
  const md = ['## איך משתמשים', '', 'כותבים ל-Claude Code בעברית.', '- פריט עם `code`', '3. שלב שלישי', '> הערה'].join('\n');
  assert.equal(
    isolateHebrewMarkdown(md),
    [`## ${RLI}איך משתמשים${PDI}`, '', `${RLI}כותבים ל-Claude Code בעברית.${PDI}`, `- ${RLI}פריט עם ${LRI}\`code\`${PDI}${PDI}`, `3. ${RLI}שלב שלישי${PDI}`, `> ${RLI}הערה${PDI}`].join('\n'),
  );
});

test('emphasis at the edges keeps a space next to the invisible marks', () => {
  assert.equal(isolateHebrewMarkdown('1. **התקנה:** טקסט'), `1. ${RLI} **התקנה:** טקסט${PDI}`);
  assert.equal(isolateHebrewMarkdown('**מה התוסף עושה:**'), `${RLI} **מה התוסף עושה:** ${PDI}`);
});

test('English lines, code blocks and div wrappers', () => {
  const md = ['<div dir="rtl">', '', '# Hebrew Mode for Claude Code', '', '</div>', '', '```bash', 'echo "שלום"', '```', '', '````text', '```', 'עדיין קוד', '````'].join('\n');
  assert.equal(
    isolateHebrewMarkdown(md),
    ['', '', '# Hebrew Mode for Claude Code', '', '', '', '```bash', 'echo "שלום"', '```', '', '````text', '```', 'עדיין קוד', '````'].join('\n'),
  );
});

test('table rows isolate only Hebrew cells, and pipes inside code stay in their cell', () => {
  assert.equal(isolateHebrewMarkdown('| Ctrl+Alt+E | `a|b` | תרגום לאנגלית |'), `| Ctrl+Alt+E | \`a|b\` | ${RLI}תרגום לאנגלית${PDI} |`);
  assert.equal(isolateHebrewMarkdown('| --- | --- |'), '| --- | --- |');
});

test('inline code keeps left-to-right order inside Hebrew lines, with the marks outside the backticks', () => {
  assert.equal(
    isolateHebrewMarkdown('הקובץ נמצא ב-`~/.claude/CLAUDE.md` עכשיו.'),
    `${RLI}הקובץ נמצא ב-${LRI}\`~/.claude/CLAUDE.md\`${PDI} עכשיו.${PDI}`,
  );
});

test('the in-product guide comes from the README: setup, key, shortcuts and CLAUDE.md, without div wrappers', () => {
  const guide = extractGuide(readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8'));
  for (const heading of ['# Hebrew Mode: מדריך', '## איך משתמשים', '## איך משיגים מפתח API של Gemini', '## קיצורי מקלדת', '## ש-Claude יענה באנגלית']) {
    assert.ok(guide.includes(heading), heading);
  }
  assert.ok(guide.includes('https://aistudio.google.com/api-keys'));
  assert.ok(!guide.includes('<div'));
  assert.ok(!guide.includes('## התקנה מקובץ VSIX'));
  assert.ok(!guide.includes('Hebrew Mode: Show Guide'), 'the guide does not point to itself');
  assert.equal(extractGuide('# nothing here'), '');
});
