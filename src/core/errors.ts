/**
 * Translation errors. Messages are user-facing Hebrew strings from
 * messages.ts and never contain the API key (see redact()).
 */

export type ErrorKind =
  | 'missingKey'
  | 'invalidKey'
  | 'rateLimitMinute'
  | 'quotaDaily'
  | 'network'
  | 'timeout'
  | 'badResponse'
  | 'blocked'
  | 'modelUnavailable'
  | 'placeholders'
  | 'overloaded'
  | 'serverError'
  | 'unsupportedLocation'
  | 'cancelled';

export class TranslationError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly details: { retryAfterSec?: number; resetAt?: Date; status?: number } = {},
  ) {
    super(message);
    this.name = 'TranslationError';
  }
}

export function isTranslationError(e: unknown, ...kinds: ErrorKind[]): e is TranslationError {
  return e instanceof TranslationError && (kinds.length === 0 || kinds.includes(e.kind));
}

/** Removes any occurrence of the key from a string. */
export function redact(text: string, key: string | undefined): string {
  if (!key || key.length < 4) return text;
  return text.split(key).join('[מפתח מוסתר]');
}
