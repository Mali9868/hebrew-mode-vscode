/**
 * Small, safe Markdown to HTML renderer for the translation panel.
 *
 * Supports what Claude answers use: headings, paragraphs, nested lists,
 * fenced code blocks, inline code, bold, italics, strikethrough, links,
 * blockquotes, tables and horizontal rules. All text is HTML-escaped; raw
 * HTML in the source is shown as text. Links are created only for http,
 * https and mailto URLs. Images are shown as links, never loaded.
 * Code (blocks and inline) is marked dir="ltr" so it stays left-to-right
 * inside the right-to-left panel.
 */

const MARK = String.fromCharCode(0xe000);
const MARK_RE = new RegExp(`${MARK}(\\d+)${MARK}`, 'g');

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(?:https?:\/\/|mailto:)/i.test(u) && !/[\s<>"]/.test(u)) return escapeHtml(u);
  return null;
}

function trimUrl(url: string): string {
  let out = url;
  while (/[.,;:!?'"\])}»”’]$/.test(out)) {
    if (out.endsWith(')') && (out.match(/\(/g) ?? []).length >= (out.match(/\)/g) ?? []).length) break;
    out = out.slice(0, -1);
  }
  return out;
}

const INLINE_TOKEN = new RegExp(
  [
    '(`+)([\\s\\S]*?[^`])\\1(?!`)', // 1,2: code span
    '(!?)\\[([^\\]\\n]*)\\]\\(\\s*<?([^\\s)<>]+)>?(?:\\s+"[^"\\n]*")?\\s*\\)', // 3,4,5: link or image
    '<((?:https?:\\/\\/|mailto:)[^\\s<>]+)>', // 6: autolink
    '(\\bhttps?:\\/\\/[^\\s<>"\'`\\p{Script=Hebrew}]+)', // 7: bare URL
  ].join('|'),
  'gu',
);

/** Renders inline Markdown to HTML. */
export function renderInline(src: string, allowLinks = true): string {
  const tokens: string[] = [];
  const keep = (html: string): string => {
    tokens.push(html);
    return `${MARK}${tokens.length - 1}${MARK}`;
  };
  let text = src.split(MARK).join('');

  text = text.replace(INLINE_TOKEN, (whole, ticks?: string, code?: string, bang?: string, label?: string, url?: string, auto?: string, bare?: string) => {
    if (ticks !== undefined && code !== undefined) {
      let c = code.replace(/\n/g, ' ');
      if (c.length > 2 && c.startsWith(' ') && c.endsWith(' ') && c.trim() !== '') c = c.slice(1, -1);
      return keep(`<code dir="ltr">${escapeHtml(c)}</code>`);
    }
    if (label !== undefined && url !== undefined) {
      const href = allowLinks ? safeHref(url) : null;
      const inner = renderInline(label || url, false);
      if (bang) return keep(href ? `<a href="${href}">${inner || escapeHtml(url)}</a>` : inner);
      return keep(href ? `<a href="${href}">${inner}</a>` : inner);
    }
    if (auto !== undefined) {
      const href = allowLinks ? safeHref(auto) : null;
      return keep(href ? `<a href="${href}" dir="ltr">${escapeHtml(auto)}</a>` : escapeHtml(whole));
    }
    if (bare !== undefined) {
      const url2 = trimUrl(bare);
      const rest = bare.slice(url2.length);
      const href = allowLinks ? safeHref(url2) : null;
      return keep(href ? `<a href="${href}" dir="ltr">${escapeHtml(url2)}</a>` : escapeHtml(url2)) + rest;
    }
    return whole;
  });

  let html = escapeHtml(text);
  html = html
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![A-Za-z0-9_])__(?=\S)([\s\S]*?\S)__(?![A-Za-z0-9_])/g, '<strong>$1</strong>')
    .replace(/(?<![*\\])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, '<em>$1</em>')
    .replace(/(?<![A-Za-z0-9_])_(?=[^\s_])([^_\n]*?[^\s_])_(?![A-Za-z0-9_])/g, '<em>$1</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
    .replace(/\n/g, '<br>\n');
  return html.replace(MARK_RE, (_, i: string) => tokens[Number(i)] ?? '');
}

// ---------------------------------------------------------------------------
// Blocks

interface Fence {
  ch: string;
  len: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>[ \t]?/;
const LIST_ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function expandTabs(line: string): string {
  return line.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '    '));
}

function indentOf(line: string): number {
  return /^ */.exec(line)?.[0].length ?? 0;
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || line.trim() === '';
}

function openFence(line: string): Fence | null {
  const m = FENCE_OPEN.exec(line);
  if (!m || !m[1]) return null;
  const ch = m[1][0] ?? '`';
  if (ch === '`' && (m[2] ?? '').includes('`')) return null;
  return { ch, len: m[1].length };
}

function closesFence(line: string, f: Fence): boolean {
  const m = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
  return !!m && !!m[1] && m[1][0] === f.ch && m[1].length >= f.len;
}

function isTableStart(lines: string[], i: number): boolean {
  const line = lines[i];
  const next = lines[i + 1];
  return line !== undefined && next !== undefined && line.includes('|') && TABLE_SEP.test(next) && next.includes('-');
}

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i] ?? '';
  return !!openFence(line) || HEADING.test(line) || HR.test(line) || QUOTE.test(line) || LIST_ITEM.test(line) || isTableStart(lines, i);
}

function splitRow(row: string): string[] {
  let r = row.trim();
  if (r.startsWith('|')) r = r.slice(1);
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < r.length; i++) {
    const ch = r[i];
    if (ch === '\\' && r[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

/** Renders block-level Markdown. `tight` drops <p> wrappers (tight list items). */
function renderBlocks(input: string[], tight = false): string {
  const lines = input.map(expandTabs);
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (isBlank(line)) {
      i++;
      continue;
    }

    const fence = openFence(line);
    if (fence) {
      const indent = indentOf(line);
      const body: string[] = [];
      i++;
      while (i < lines.length && !closesFence(lines[i] ?? '', fence)) {
        const l = lines[i] ?? '';
        body.push(l.slice(Math.min(indent, indentOf(l))));
        i++;
      }
      i++; // closing fence (or end of input)
      out.push(`<pre dir="ltr"><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading && heading[1]) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2] ?? '')}</h${level}>`);
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && !isBlank(lines[i]) && (QUOTE.test(lines[i] ?? '') || !startsBlock(lines, i))) {
        inner.push((lines[i] ?? '').replace(QUOTE, ''));
        i++;
      }
      out.push(`<blockquote>${renderBlocks(inner)}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, i)) {
      const header = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && !isBlank(lines[i]) && (lines[i] ?? '').includes('|')) {
        rows.push(splitRow(lines[i] ?? ''));
        i++;
      }
      const th = header.map((c) => `<th>${renderInline(c)}</th>`).join('');
      const trs = rows
        .map((r) => `<tr>${header.map((_, k) => `<td>${renderInline(r[k] ?? '')}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`);
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { html, next } = renderList(lines, i);
      out.push(html);
      i = next;
      continue;
    }

    // Paragraph
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines, i))) {
      para.push((lines[i] ?? '').trim());
      i++;
    }
    const inline = renderInline(para.join('\n'));
    out.push(tight ? inline : `<p>${inline}</p>`);
  }
  return out.join('\n');
}

function renderList(lines: string[], start: number): { html: string; next: number } {
  const first = LIST_ITEM.exec(lines[start] ?? '');
  const ordered = !!first && /\d/.test(first[2] ?? '');
  const startNum = ordered && first ? parseInt(first[2] ?? '1', 10) : 1;
  const items: string[][] = [];
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const m = LIST_ITEM.exec(lines[i] ?? '');
    if (!m || /\d/.test(m[2] ?? '') !== ordered) break;
    const markerWidth = (m[1] ?? '').length + (m[2] ?? '').length;
    const gap = (m[3] ?? '').length;
    const contentIndent = markerWidth + (gap === 0 || gap > 4 ? 1 : gap);
    const item: string[] = [m[4] ?? ''];
    i++;
    while (i < lines.length) {
      const l = lines[i] ?? '';
      if (isBlank(l)) {
        let j = i + 1;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j] ?? '') >= contentIndent) {
          for (let k = i; k < j; k++) item.push('');
          i = j;
          continue;
        }
        break;
      }
      if (indentOf(l) >= contentIndent) {
        item.push(l.slice(contentIndent));
        i++;
        continue;
      }
      // Lazy continuation of the item's paragraph.
      if (!startsBlock(lines, i) && !isBlank(item[item.length - 1])) {
        item.push(l.trim());
        i++;
        continue;
      }
      break;
    }
    items.push(item);
    // Blank lines between items make the list loose.
    let j = i;
    while (j < lines.length && isBlank(lines[j])) j++;
    const nextItem = LIST_ITEM.exec(lines[j] ?? '');
    if (j > i && nextItem && /\d/.test(nextItem[2] ?? '') === ordered) {
      loose = true;
      i = j;
    }
    if (item.some((l, k) => k > 0 && isBlank(l))) loose = true;
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  const lis = items.map((it) => `<li>${renderBlocks(it, !loose)}</li>`).join('\n');
  return { html: `<${tag}${startAttr}>\n${lis}\n</${tag}>`, next: i };
}

export function renderMarkdown(src: string): string {
  const text = src.replace(/\r\n?/g, '\n');
  return renderBlocks(text.split('\n'));
}
