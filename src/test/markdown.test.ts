import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, renderInline } from '../core/markdown';
import { panelHtml } from '../core/panelHtml';

test('fenced code blocks render LTR, escaped, with original indentation', () => {
  const html = renderMarkdown('הנה הקוד:\n\n```ts\nif (a < b) {\n  run("x");\n}\n```');
  assert.match(html, /<pre dir="ltr"><code>if \(a &lt; b\) \{\n  run\(&quot;x&quot;\);\n\}<\/code><\/pre>/);
  assert.match(html, /<p>הנה הקוד:<\/p>/);
});

test('inline code is LTR and escaped; markup inside it is not rendered', () => {
  const html = renderInline('השתמשי ב-`a **b** <i>` עכשיו');
  assert.equal(html, 'השתמשי ב-<code dir="ltr">a **b** &lt;i&gt;</code> עכשיו');
});

test('raw HTML and scripts in the translation are shown as text', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;script&gt;/);
});

test('only http, https and mailto links become anchors; images never load', () => {
  const html = renderMarkdown('[טוב](https://example.com/a_b) [רע](javascript:alert(1)) ![תמונה](https://example.com/x.png) <https://x.io>');
  assert.match(html, /<a href="https:\/\/example.com\/a_b">טוב<\/a>/);
  assert.ok(!html.includes('javascript:alert(1)"'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /<a href="https:\/\/example.com\/x.png">תמונה<\/a>/);
  assert.match(html, /<a href="https:\/\/x.io" dir="ltr">https:\/\/x.io<\/a>/);
});

test('bare URLs are linked without trailing punctuation', () => {
  assert.equal(
    renderInline('ראי https://example.com/docs.'),
    'ראי <a href="https://example.com/docs" dir="ltr">https://example.com/docs</a>.',
  );
});

test('emphasis: bold, italics, strikethrough; snake_case is untouched', () => {
  assert.equal(renderInline('**חשוב** ו-*נטוי* ו-~~מחוק~~ ו-user_id_value'), '<strong>חשוב</strong> ו-<em>נטוי</em> ו-<del>מחוק</del> ו-user_id_value');
});

test('headings, rules and blockquotes', () => {
  const html = renderMarkdown('# כותרת\n## משנה ##\n---\n> ציטוט\n> שני');
  assert.match(html, /<h1>כותרת<\/h1>/);
  assert.match(html, /<h2>משנה<\/h2>/);
  assert.match(html, /<hr>/);
  assert.match(html, /<blockquote><p>ציטוט<br>\nשני<\/p><\/blockquote>/);
});

test('nested lists with a code block inside an item', () => {
  const md = ['1. ראשון', '   - תת סעיף `x`', '   - עוד', '2. שני:', '', '   ```bash', '   npm test', '   ```', '3. שלישי'].join('\n');
  const html = renderMarkdown(md);
  assert.match(html, /^<ol>/);
  // A blank line inside item 2 makes the list loose (as in CommonMark), so items get <p>.
  assert.match(html, /<li><p>ראשון<\/p>\n<ul>\n<li>תת סעיף <code dir="ltr">x<\/code><\/li>\n<li>עוד<\/li>\n<\/ul><\/li>/);
  assert.match(renderMarkdown('- א\n  - ב\n- ג'), /<ul>\n<li>א\n<ul>\n<li>ב<\/li>\n<\/ul><\/li>\n<li>ג<\/li>\n<\/ul>/, 'tight list has no <p>');
  assert.match(html, /<pre dir="ltr"><code>npm test<\/code><\/pre>/);
  assert.equal((html.match(/<li>/g) ?? []).length, 5);
});

test('ordered list keeps its start number', () => {
  assert.match(renderMarkdown('3. ג\n4. ד'), /<ol start="3">/);
});

test('tables, including pipes inside inline code', () => {
  const html = renderMarkdown('| קובץ | תפקיד |\n| --- | :---: |\n| `a|b` | בדיקה |');
  assert.match(html, /<th>קובץ<\/th><th>תפקיד<\/th>/);
  assert.match(html, /<td><code dir="ltr">a\|b<\/code><\/td><td>בדיקה<\/td>/);
});

test('unclosed fence renders to the end', () => {
  assert.match(renderMarkdown('```\nconst a = 1;'), /<pre dir="ltr"><code>const a = 1;<\/code><\/pre>/);
});

test('panel: RTL document, strict CSP with nonce, copy button, rendered content', () => {
  const html = panelHtml('**שלום** `code`', 'abc123');
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'nonce-abc123'; script-src 'nonce-abc123';"/);
  assert.match(html, /<button id="copy" type="button">העתקה<\/button>/);
  assert.match(html, /<strong>שלום<\/strong> <code dir="ltr">code<\/code>/);
  assert.equal((html.match(/<script nonce="abc123">/g) ?? []).length, 1);
  assert.equal((html.match(/<script/g) ?? []).length, 1, 'no other script tags');
});

test('panel: translated text cannot inject markup or break out of the script', () => {
  const html = panelHtml('</script><script>alert(1)</script>', 'n');
  assert.equal((html.match(/<script/g) ?? []).length, 1);
});

test('panel with a custom action: the guide gets a key setup button that posts its own message', () => {
  const html = panelHtml('# מדריך', 'n', { id: 'setKey', label: 'הגדרת מפתח' });
  assert.match(html, /<button id="setKey" type="button">הגדרת מפתח<\/button>/);
  assert.match(html, /const id = "setKey";/);
  assert.ok(!html.includes('id="copy"'));
});
