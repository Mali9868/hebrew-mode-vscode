/** Adding a term to a glossary list: one line, up to 60 characters, no duplicates (case-insensitive). */

export const MAX_TERM_LENGTH = 60;

export type GlossaryAddResult = { ok: true; list: string[]; term: string } | { ok: false; reason: 'empty' | 'invalid' | 'duplicate' };

export function addGlossaryTerm(list: readonly string[], raw: string): GlossaryAddResult {
  const term = raw.trim();
  if (term === '') return { ok: false, reason: 'empty' };
  if (/[\r\n]/.test(term) || term.length > MAX_TERM_LENGTH) return { ok: false, reason: 'invalid' };
  if (list.some((t) => t.trim().toLowerCase() === term.toLowerCase())) return { ok: false, reason: 'duplicate' };
  return { ok: true, list: [...list, term], term };
}
