/**
 * Secret guard: scans text for API keys, tokens, JWTs, private keys and
 * KEY=value env lines before anything is sent to the translation service.
 * Fenced code blocks are skipped because they are never sent.
 */
import { findFencedBlocks, Span } from './contentProtector';

export interface SecretFinding extends Span {
  /** 1-based line number in the original text. */
  line: number;
  /** Human readable type, e.g. "Google API key". */
  type: string;
  /** Masked preview that never reveals the secret, e.g. "AIza…(39 תווים)". */
  preview: string;
}

interface Pattern {
  type: string;
  re: RegExp;
  /** Validates the match (e.g. skip obvious placeholders). */
  accept?: (m: RegExpExecArray) => boolean;
}

const PLACEHOLDER_VALUE = /^(?:<[^>]*>|\$\{?[A-Za-z_][\w]*\}?|x{3,}|\*{3,}|\.{3}|your[-_ ].*|changeme|example|placeholder|todo|null|none|true|false|\d{1,6}|""|'')$/i;

const SENSITIVE_NAME = /(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PASS|PWD|CREDENTIALS?|AUTH|PRIVATE|DSN|CONN(?:ECTION)?_?STRING|DATABASE_URL)/i;

const PATTERNS: Pattern[] = [
  { type: 'Private key', re: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/g },
  { type: 'JWT', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { type: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { type: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { type: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { type: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { type: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { type: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { type: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { type: 'Stripe key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { type: 'Twilio key', re: /\bSK[0-9a-f]{32}\b/g },
  { type: 'SendGrid key', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g },
  { type: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { type: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{30,}\b/g },
  {
    type: 'Password in URL',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s@/]+)@[^\s]+/gi,
    accept: (m) => !PLACEHOLDER_VALUE.test(m[1] ?? ''),
  },
  {
    type: 'Bearer token',
    re: /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g,
  },
  {
    // KEY=value lines from env files: sensitive name, or a long high-entropy value.
    type: 'Env secret',
    re: /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_.]*)[ \t]*[=:][ \t]*(["']?)([^\s"'#]+)\2[ \t]*(?:#.*)?$/gm,
    accept: (m) => {
      const name = m[1] ?? '';
      const value = m[3] ?? '';
      if (PLACEHOLDER_VALUE.test(value)) return false;
      if (SENSITIVE_NAME.test(name)) return value.length >= 6;
      return /^[A-Z][A-Z0-9_]*$/.test(name) && looksRandom(value);
    },
  },
];

/** Heuristic for random-looking tokens: long, mixed character classes, no spaces. */
function looksRandom(value: string): boolean {
  if (value.length < 20) return false;
  if (/^https?:\/\//i.test(value)) return false;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((r) => r.test(value)).length;
  return classes >= 3;
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function mask(secret: string): string {
  const firstLine = secret.split('\n')[0] ?? '';
  const head = firstLine.startsWith('-----') ? firstLine : firstLine.slice(0, 4);
  return `${head}…(${secret.length} תווים)`;
}

/** Returns all secrets found outside fenced code blocks, ordered by position, without overlaps. */
export function scanSecrets(text: string): SecretFinding[] {
  const skip = findFencedBlocks(text);
  const inSkipped = (s: number, e: number): boolean => skip.some((b) => s >= b.start && e <= b.end);
  const found: SecretFinding[] = [];
  const overlaps = (s: number, e: number): boolean => found.some((f) => s < f.end && e > f.start);

  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = p.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        p.re.lastIndex++;
        continue;
      }
      if (p.accept && !p.accept(m)) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (inSkipped(start, end) || overlaps(start, end)) continue;
      found.push({ start, end, line: lineOf(text, start), type: p.type, preview: mask(m[0]) });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}
