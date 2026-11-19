/**
 * VS Code's own UI (notifications, dialogs, status bar, input boxes) is
 * left-to-right. A Hebrew sentence with English words in it, such as
 * "לא הוגדר מפתח Gemini. פותחת את הגדרת המפתח.", is then shown with its parts
 * in the wrong order. Wrapping each Hebrew line in a right-to-left isolate
 * (RLI ... PDI, invisible characters) keeps the reading order right.
 * URLs inside a Hebrew line get their own left-to-right isolate, or their
 * slashes and dots come out in the wrong order. Lines whose first letter is
 * not Hebrew are left as they are.
 */
const RLI = String.fromCharCode(0x2067);
const LRI = String.fromCharCode(0x2066);
const PDI = String.fromCharCode(0x2069);
const URL_RE = /https?:\/\/[^\s]*[^\s.,;:!?)]/g;

function startsWithHebrew(line: string): boolean {
  const first = /\p{L}/u.exec(line);
  return first !== null && /\p{Script=Hebrew}/u.test(first[0]);
}

export function rtlIsolate(message: string): string {
  return message
    .split('\n')
    .map((line) => (startsWithHebrew(line) ? `${RLI}${line.replace(URL_RE, (url) => `${LRI}${url}${PDI}`)}${PDI}` : line))
    .join('\n');
}
