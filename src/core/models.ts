/**
 * Model selection. No model name is hardcoded: we list the models available
 * to the key and pick the newest stable model of the requested tier.
 */

export type ModelTier = 'flash-lite' | 'flash';

export interface ApiModel {
  name: string; // "models/gemini-2.5-flash-lite"
  supportedGenerationMethods?: string[];
  displayName?: string;
}

interface Parsed {
  name: string;
  version: number[];
  tier: ModelTier;
  /** Numeric revision suffix such as "-001", or -1 for none. */
  revision: number;
  stable: boolean;
}

export function parseModel(fullName: string): Parsed | null {
  const name = fullName.replace(/^models\//, '');
  const m = /^gemini-(\d+(?:\.\d+)*)-(flash-lite|flash)(?:-(.*))?$/.exec(name);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const suffix = m[3] ?? '';
  const revMatch = /^(\d{3})$/.exec(suffix);
  // Only "gemini-X-tier" and "gemini-X-tier-001" are stable; preview, exp, latest etc. are not.
  const stable = suffix === '' || revMatch !== null;
  return {
    name,
    version: m[1].split('.').map(Number),
    tier: m[2] as ModelTier,
    revision: revMatch && revMatch[1] ? Number(revMatch[1]) : -1,
    stable,
  };
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function supportsGenerateContent(m: ApiModel): boolean {
  return (m.supportedGenerationMethods ?? []).includes('generateContent');
}

/**
 * Picks the newest stable model of the given tier. Among equal versions the
 * unsuffixed alias (which Google points at the latest stable revision) wins,
 * then the highest numeric revision. Returns the bare id, e.g. "gemini-2.5-flash-lite".
 */
export function pickModel(models: readonly ApiModel[], tier: ModelTier): string | null {
  const candidates = models
    .filter(supportsGenerateContent)
    .map((m) => parseModel(m.name))
    .filter((p): p is Parsed => p !== null && p.tier === tier && p.stable);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const v = compareVersions(b.version, a.version);
    if (v !== 0) return v;
    if (a.revision === -1 && b.revision !== -1) return -1;
    if (b.revision === -1 && a.revision !== -1) return 1;
    return b.revision - a.revision;
  });
  return candidates[0]?.name ?? null;
}

/** Major version, used to choose how thinking is turned off. */
export function majorVersion(model: string): number {
  return parseModel(model)?.version[0] ?? 0;
}
