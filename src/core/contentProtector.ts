/**
 * Content Protector.
 *
 * Replaces content that must never be translated (code blocks, inline code,
 * URLs, file paths, CLI flags, env vars, @mentions, glossary terms) with
 * stable placeholders such as ⟦P7⟧. Only the remaining prose is sent to the
 * translation model. After translation every placeholder must come back
 * exactly once and unchanged, otherwise the translation is rejected.
 *
 * This module has no VS Code dependency so it can be unit tested in Node.
 */

export type ProtectedKind =
  | 'codeBlock'
  | 'inlineCode'
  | 'url'
  | 'email'
  | 'path'
  | 'flag'
  | 'envVar'
  | 'mention'
  | 'glossary'
  | 'identifier'
  | 'command'
  | 'secret'
  | 'literalPlaceholder';

export interface ProtectedItem {
  token: string;
  original: string;
  kind: ProtectedKind;
}

export interface ProtectResult {
  /** Text with every protected element replaced by a placeholder. */
  text: string;
  items: ProtectedItem[];
  /** True when nothing translatable is left (only placeholders, whitespace, punctuation). */
  onlyProtected: boolean;
}

export interface Span {
  start: number;
  end: number;
}

export interface ProtectOptions {
  /** Terms that must never be translated (case-insensitive, whole word). */
  glossary?: readonly string[];
  /** Extra spans to protect, e.g. secrets the user chose to mask. Offsets refer to the input text. */
  extraSpans?: readonly Span[];
  /**
   * Translation direction. For Hebrew to English, a command line written without
   * backticks (for example "npm install --save-dev vitest" inside Hebrew text) is
   * protected as a whole: in Hebrew text its end is clear (the next Hebrew letter).
   */
  direction?: Direction;
}

export type RestoreResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'missing' | 'duplicated' | 'altered'; tokens: string[] };

const OPEN = '⟦';
const CLOSE = '⟧';
const TOKEN_RE = /⟦P(\d+)⟧/g;

/** Characters trimmed from the end of URLs and paths (sentence punctuation, incl. Hebrew). */
const TRAILING_PUNCT = /[.,;:!?'"״׳)\]}>»”’]+$/;

function trimTrailing(match: string): string {
  // Keep a closing paren if the match has a matching opening one (e.g. wiki URLs).
  let out = match;
  for (;;) {
    const m = TRAILING_PUNCT.exec(out);
    if (!m) return out;
    const last = out[out.length - 1];
    if (last === ')' && countChar(out, '(') >= countChar(out, ')')) return out;
    out = out.slice(0, -1);
    if (out.length === 0) return out;
  }
}

function countChar(s: string, c: string): number {
  let n = 0;
  for (const ch of s) if (ch === c) n++;
  return n;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Finds fenced code blocks (``` or ~~~), including indented ones in lists and unclosed ones. */
export function findFencedBlocks(text: string): Span[] {
  const spans: Span[] = [];
  const lines = text.split('\n');
  let offset = 0;
  let open: { start: number; ch: string; len: number } | null = null;
  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;
    const content = line.replace(/\r$/, '');
    const fence = /^[ \t]*(?:>[ \t]*)*(`{3,}|~{3,})(.*)$/.exec(content);
    if (!open) {
      if (fence && fence[1] !== undefined) {
        const marker = fence[1];
        const ch = marker[0] ?? '`';
        const info = fence[2] ?? '';
        // A backtick fence's info string cannot contain backticks.
        if (ch === '`' && info.includes('`')) continue;
        open = { start: lineStart, ch, len: marker.length };
      }
    } else if (fence && fence[1] !== undefined) {
      const marker = fence[1];
      const rest = (fence[2] ?? '').trim();
      if (marker[0] === open.ch && marker.length >= open.len && rest === '') {
        spans.push({ start: open.start, end: lineEnd });
        open = null;
      }
    }
  }
  if (open) spans.push({ start: open.start, end: text.length });
  return spans;
}

interface Rule {
  kind: ProtectedKind;
  re: RegExp;
  /** Optional post-processing of a match; return the protected substring (prefix of match). */
  trim?: (m: string) => string;
  /** Group index holding the protected part when the regex needs a leading context group. */
  group?: number;
}

const CLI_PROGRAMS = [
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'deno', 'node', 'tsc', 'git', 'gh', 'docker', 'docker-compose', 'kubectl',
  'helm', 'terraform', 'pip', 'pip3', 'python', 'python3', 'uv', 'poetry', 'pytest', 'cargo', 'rustc', 'go', 'dotnet',
  'mvn', 'gradle', 'make', 'cmake', 'curl', 'wget', 'ssh', 'scp', 'cd', 'ls', 'mkdir', 'rm', 'cp', 'mv', 'cat', 'chmod',
  'sudo', 'brew', 'apt', 'apt-get', 'claude', 'code', 'vsce', 'eslint', 'prettier', 'jest', 'vitest', 'supabase',
  'vercel', 'netlify', 'firebase', 'prisma', 'expo', 'flutter', 'ng', 'composer', 'php', 'ruby', 'bundle', 'rails',
];

/** A command line inside Hebrew text: a known program, at least one argument, until the next Hebrew letter or line end. */
const COMMAND_RE = new RegExp(
  `(?<![A-Za-z0-9_./\\\\-])(?:${CLI_PROGRAMS.map(escapeRegExp).join('|')})(?:[ \\t]+[^\\s\\p{Script=Hebrew}⟦⟧]+)+`,
  'gu',
);

function buildRules(glossary: readonly string[], direction?: Direction): Rule[] {
  const rules: Rule[] = [
    // Literal placeholder-like text already present in the input.
    { kind: 'literalPlaceholder', re: /⟦[^⟧\n]*⟧|[⟦⟧]/g },
    // Inline code: `x`, ``x``.
    { kind: 'inlineCode', re: /(?<!`)(`+)(?!`)[^\n]*?[^`\n]\1(?!`)/g },
    // URLs.
    { kind: 'url', re: /\b(?:https?|ftp|file|wss?|ssh|git):\/\/[^\s<>"'`⟦⟧\u0590-\u05FF]+/gi, trim: trimTrailing },
    { kind: 'url', re: /\bwww\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+[^\s<>"'`⟦⟧\u0590-\u05FF]*/g, trim: trimTrailing },
    // Emails (before @mentions so they stay whole).
    { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
    // @mentions: @file, @src/app.ts, @scope/package, @user.
    { kind: 'mention', re: /(?<![A-Za-z0-9_.])@[A-Za-z0-9_][A-Za-z0-9_./:#-]*/g, trim: trimTrailing },
    // Env vars: $VAR, ${VAR}, %VAR%, process.env.VAR, and SCREAMING_SNAKE_CASE names.
    { kind: 'envVar', re: /\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*|%[A-Za-z_][A-Za-z0-9_]*%|\b(?:process\.env|import\.meta\.env|os\.environ)(?:\.[A-Za-z_][A-Za-z0-9_]*|\[['"][A-Za-z_][A-Za-z0-9_]*['"]\])?/g },
    { kind: 'envVar', re: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g },
    // File paths: with a directory separator (relative, absolute, home, Windows).
    {
      kind: 'path',
      re: /(?<![A-Za-z0-9_./\\])(?<![A-Za-z0-9_]-)(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?(?:[A-Za-z0-9_.@][A-Za-z0-9_.@-]*[\\/])+[A-Za-z0-9_.@-]*/g,
      trim: trimTrailing,
    },
    // Bare file names with a known extension: package.json, index.ts, .env.local
    {
      kind: 'path',
      re: /(?<![A-Za-z0-9_./\\])(?<![A-Za-z0-9_]-)(?:\.?[A-Za-z0-9_][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*\.(?:tsx?|jsx?|mjs|cjs|json|jsonc|md|mdx|ya?ml|toml|ini|cfg|conf|env|lock|py|rb|go|rs|java|kt|swift|c|h|cpp|hpp|cs|php|sh|bash|zsh|ps1|sql|html?|css|scss|less|vue|svelte|xml|txt|csv|log|gradle|dart|lua|r)\b|\.(?:env|gitignore|npmrc|nvmrc|editorconfig|prettierrc|eslintrc)(?:\.[A-Za-z0-9_-]+)*|Dockerfile|Makefile|README|CLAUDE\.md)(?![A-Za-z0-9_])/g,
    },
    // Code identifiers: calls like foo() or obj.run(x), dotted members like console.log,
    // camelCase, PascalCase with two or more humps, snake_case.
    { kind: 'identifier', re: /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?!\(s\))\([^()\s]*\)/g },
    { kind: 'identifier', re: /\b[A-Za-z_$][\w$]+(?:\.[A-Za-z_$][\w$]+)+\b/g },
    { kind: 'identifier', re: /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+\b/g },
    { kind: 'identifier', re: /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)+\b|\b[A-Z]{2,}[a-z]{2,}[A-Za-z0-9]*\b/g },
    { kind: 'identifier', re: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g },
    // CLI flags: --force, -rf, --name=value
    { kind: 'flag', re: /(?<![A-Za-z0-9_\-\u0590-\u05FF])--?[A-Za-z][A-Za-z0-9_-]*(?:=[^\s⟦⟧]+)?/g },
  ];
  if (direction === 'he-en') {
    // Before the URL, path and flag rules so the whole command stays one placeholder.
    rules.splice(2, 0, { kind: 'command', re: COMMAND_RE, trim: trimTrailing });
  }
  const terms = glossary
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .sort((a, b) => b.length - a.length);
  if (terms.length > 0) {
    const alt = terms.map(escapeRegExp).join('|');
    rules.push({ kind: 'glossary', re: new RegExp(`(?<![\\p{L}\\p{N}_])(?<![A-Za-z0-9_]-)(?:${alt})(?![\\p{L}\\p{N}_]|-[A-Za-z0-9])`, 'giu') });
  }
  return rules;
}

/**
 * Replaces protected content with placeholders.
 * Spans are collected on the original text so placeholders never nest.
 */
export function protect(input: string, options: ProtectOptions = {}): ProtectResult {
  const taken: Array<Span & { kind: ProtectedKind }> = [];
  const overlaps = (s: number, e: number): boolean => taken.some((t) => s < t.end && e > t.start);

  for (const span of options.extraSpans ?? []) {
    if (span.end > span.start && !overlaps(span.start, span.end)) taken.push({ ...span, kind: 'secret' });
  }
  for (const span of findFencedBlocks(input)) {
    if (!overlaps(span.start, span.end)) taken.push({ ...span, kind: 'codeBlock' });
  }

  for (const rule of buildRules(options.glossary ?? [], options.direction)) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(input)) !== null) {
      let matched = m[0];
      if (matched.length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      if (rule.trim) matched = rule.trim(matched);
      const start = m.index;
      const end = start + matched.length;
      if (matched.length === 0) continue;
      if (rule.kind === 'path' && !looksLikePath(matched)) continue;
      if (!overlaps(start, end)) taken.push({ start, end, kind: rule.kind });
    }
  }

  taken.sort((a, b) => a.start - b.start);
  const items: ProtectedItem[] = [];
  let out = '';
  let pos = 0;
  let n = 1;
  for (const span of taken) {
    out += input.slice(pos, span.start);
    const token = `${OPEN}P${n++}${CLOSE}`;
    items.push({ token, original: input.slice(span.start, span.end), kind: span.kind });
    out += token;
    pos = span.end;
  }
  out += input.slice(pos);

  const prose = out.replace(TOKEN_RE, '');
  const onlyProtected = !/[\p{L}\p{N}]/u.test(prose);
  return { text: out, items, onlyProtected };
}

/** Filters out path-regex false positives such as a lone "/" or "a/b" fractions like "1/2". */
function looksLikePath(s: string): boolean {
  return /[A-Za-z]/.test(s);
}

/**
 * Verifies that every placeholder appears exactly once and unchanged, then
 * restores the original content. Any deviation aborts the restore.
 */
export function restore(translated: string, items: readonly ProtectedItem[]): RestoreResult {
  let text = unwrapBlockPlaceholders(translated, items);

  const missing: string[] = [];
  const duplicated: string[] = [];
  for (const item of items) {
    const count = text.split(item.token).length - 1;
    if (count === 0) missing.push(item.token);
    else if (count > 1) duplicated.push(item.token);
  }
  if (missing.length > 0) return { ok: false, reason: 'missing', tokens: missing };
  if (duplicated.length > 0) return { ok: false, reason: 'duplicated', tokens: duplicated };

  // Anything bracket-like left over (unknown ids, broken brackets) means the model altered a placeholder.
  let rest = text;
  for (const item of items) rest = rest.split(item.token).join('');
  const strays = rest.match(/⟦[^⟧\n]*⟧?|⟧|\[\[\s*P\d+\s*\]\]|\bP\d+⟧/g);
  if (strays) return { ok: false, reason: 'altered', tokens: strays };

  // Restore in a single pass so restored content can never be re-interpreted as a token.
  const byToken = new Map(items.map((i) => [i.token, i.original] as const));
  text = text.replace(TOKEN_RE, (tok) => byToken.get(tok) ?? tok);
  return { ok: true, text };
}

/**
 * Models sometimes wrap a code-block placeholder in its own ``` fence.
 * Remove that wrapper since the placeholder already restores to a full block.
 */
function unwrapBlockPlaceholders(text: string, items: readonly ProtectedItem[]): string {
  let out = text;
  for (const item of items) {
    if (item.kind !== 'codeBlock') continue;
    const tok = escapeRegExp(item.token);
    out = out.replace(new RegExp('(^|\\n)[ \\t]*```[^\\n`]*\\n[ \\t]*' + tok + '[ \\t]*\\n[ \\t]*```[ \\t]*(?=\\n|$)', 'g'), `$1${item.token}`);
  }
  return out;
}

/** Share of Hebrew letters among all letters in the prose (protected content excluded). */
interface ProseStats {
  /** Share of Hebrew letters among all letters in the prose. */
  ratio: number;
  /** True when the first letter of the prose is Hebrew. */
  startsHebrew: boolean;
}

/** Letter statistics of the prose only: protected content (code, paths, glossary terms...) is ignored. */
function proseStats(text: string, glossary: readonly string[]): ProseStats {
  const prose = protect(text, { glossary }).text.replace(TOKEN_RE, '');
  let hebrew = 0;
  let letters = 0;
  let first: boolean | undefined;
  for (const ch of prose) {
    if (/\p{L}/u.test(ch)) {
      letters++;
      const isHebrew = /\p{Script=Hebrew}/u.test(ch);
      if (isHebrew) hebrew++;
      if (first === undefined) first = isHebrew;
    }
  }
  return { ratio: letters === 0 ? 0 : hebrew / letters, startsHebrew: first === true };
}

/** Share of Hebrew letters among all letters in the prose (protected content excluded). */
export function hebrewRatio(text: string, glossary: readonly string[] = []): number {
  return proseStats(text, glossary).ratio;
}

export type Direction = 'he-en' | 'en-he';

/**
 * Direction by the share of Hebrew letters in the prose. 30% or more is Hebrew.
 * Between 10% and 30% (short Hebrew instructions full of English terms, or English
 * answers that quote Hebrew strings) the first word decides.
 */
export function detectDirection(text: string, glossary: readonly string[] = []): Direction {
  const { ratio, startsHebrew } = proseStats(text, glossary);
  if (ratio >= 0.3) return 'he-en';
  if (ratio >= 0.1 && startsHebrew) return 'he-en';
  return 'en-he';
}

