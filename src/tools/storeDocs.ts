/**
 * Prepares README.md and CHANGELOG.md for the extension page (packaging time only).
 *
 * VS Code's extension page drops dir="rtl", so a Hebrew line with English words
 * in it is shown with its parts in the wrong order. This wraps the text of every
 * line that contains Hebrew in a right-to-left isolate (invisible RLI ... PDI
 * characters), keeps inline code left-to-right inside it, and removes the
 * <div dir="rtl"> wrappers that only GitHub honors. Fenced code blocks are left
 * untouched. The README in the repository stays clean.
 */
const RLI = String.fromCharCode(0x2067);
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
const HEBREW = /\p{Script=Hebrew}/u;

/**
 * Wraps text in a right-to-left isolate. Inside it, each inline code span gets its own
 * left-to-right isolate, outside the backticks (so copying the code does not copy the marks),
 * or paths like ~/.claude/CLAUDE.md come out reversed. Emphasis markers next to an invisible
 * character may stop working, so keep a space between them.
 */
function isolate(text: string): string {
  const withCode = text.replace(/`[^`\n]+`/g, (code) => `${LRI}${code}${PDI}`);
  const lead = /^[*_]/.test(text) ? ' ' : '';
  const trail = /[*_]$/.test(text) ? ' ' : '';
  return `${RLI}${lead}${withCode}${trail}${PDI}`;
}

/** Splits a table row on cell borders, ignoring pipes inside inline code. */
function splitRow(row: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  for (const ch of row) {
    if (ch === '`') inCode = !inCode;
    if (ch === '|' && !inCode) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

export function isolateHebrewMarkdown(markdown: string): string {
  const out: string[] = [];
  let fence: { ch: string; len: number } | null = null;

  for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      out.push(line);
      const m = marker?.[1];
      if (m && m[0] === fence.ch && m.length >= fence.len && (marker?.[2] ?? '').trim() === '') fence = null;
      continue;
    }
    if (marker?.[1]) {
      fence = { ch: marker[1][0] ?? '`', len: marker[1].length };
      out.push(line);
      continue;
    }
    if (/^\s*<\/?div\b[^>]*>\s*$/i.test(line)) {
      out.push('');
      continue;
    }
    if (!HEBREW.test(line)) {
      out.push(line);
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const cells = splitRow(line);
      out.push(
        cells
          .map((cell, i) => (i === 0 || i === cells.length - 1 || !HEBREW.test(cell) ? cell : ` ${isolate(cell.trim())} `))
          .join('|'),
      );
      continue;
    }
    const m = /^(\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?)(.*)$/.exec(line);
    out.push(`${m?.[1] ?? ''}${isolate(m?.[2] ?? line)}`);
  }
  return out.join('\n');
}

/**
 * The in-product guide: the README from "## איך משתמשים" up to "## התקנה מקובץ VSIX"
 * (setup, getting a key, shortcuts, asking Claude to answer in English), without the
 * GitHub-only div wrappers. One source for the README and the guide.
 */
export function extractGuide(readme: string): string {
  const lines = readme.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((l) => l.startsWith('## איך משתמשים'));
  if (start < 0) return '';
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## התקנה מקובץ VSIX'));
  const body = lines
    .slice(start, end > start ? end : undefined)
    .filter((l) => !/^\s*<\/?div\b[^>]*>\s*$/i.test(l))
    // The line that points to the guide itself is not needed inside the guide.
    .filter((l) => !l.includes('Hebrew Mode: Show Guide'));
  return `${['# Hebrew Mode: מדריך', '', ...body].join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}
