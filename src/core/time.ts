/** Time helpers. Gemini daily quotas reset at midnight Pacific time; users see Israel time. */

const PACIFIC = 'America/Los_Angeles';
const ISRAEL = 'Asia/Jerusalem';

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsIn(d: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Offset of a time zone from UTC at a given instant, in ms (Los Angeles is negative). */
function offsetMs(d: Date, timeZone: string): number {
  const p = partsIn(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

/** Next midnight in Los Angeles, when Gemini daily quotas reset. */
export function nextPacificMidnight(now: Date): Date {
  const p = partsIn(now, PACIFIC);
  const guess = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0);
  let result = guess - offsetMs(new Date(guess), PACIFIC);
  // Second pass handles a daylight saving change between now and midnight.
  result = guess - offsetMs(new Date(result), PACIFIC);
  return new Date(result);
}

/** "2026-11-19": the current quota day (Pacific calendar date). */
export function pacificDateKey(now: Date): string {
  const p = partsIn(now, PACIFIC);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** "20.11 בשעה 10:00" in Israel time. */
export function formatIsraelTime(d: Date): string {
  const p = partsIn(d, ISRAEL);
  return `${p.day}.${p.month} בשעה ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
