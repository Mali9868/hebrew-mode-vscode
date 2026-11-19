/**
 * Every user-facing string in one place, so wording stays consistent and
 * can be checked automatically (no em dashes, no key material).
 */
import { formatIsraelTime } from './time';

export const KEY_URL = 'https://aistudio.google.com/api-keys';

export const MESSAGES = {
  // Failure table (SPEC.md)
  missingKey: 'לא הוגדר מפתח Gemini. פותחת את הגדרת המפתח.',
  invalidKey: 'מפתח Gemini לא תקין או שאין לו הרשאה. פותחת את הגדרת המפתח.',
  emptyClipboard: 'העתיקי קודם את הטקסט',
  rateLimitMinute: (sec: number): string => `הגעת למגבלת הבקשות לדקה. נסי שוב בעוד ${sec} שניות.`,
  quotaDaily: (resetAt: Date): string => `המכסה היומית נגמרה. היא מתחדשת ב-${formatIsraelTime(resetAt)} שעון ישראל.`,
  failed: 'התרגום נכשל. הטקסט המקורי נשאר בלוח.',
  timeout: 'התרגום נכשל: Gemini לא ענה בזמן. הטקסט המקורי נשאר בלוח.',
  blocked: 'התרגום נכשל: Gemini סירב לתרגם את הטקסט. הטקסט המקורי נשאר בלוח.',
  placeholders: 'התרגום שינה קוד, בוטל. הטקסט המקורי נשאר בלוח.',
  secretFound: 'נמצא בטקסט משהו שנראה כמו מפתח או סיסמה, ולכן התרגום נעצר.',
  secretLine: (line: number, type: string, preview: string): string => `שורה ${line}: ${type} (${preview})`,
  secretExplain: 'בלחיצה על "הסתר ותרגם" הסוד מוחלף בסמן מוגן ולא נשלח ל-Gemini. בתרגום הוא חוזר למקומו בלי שינוי.',
  maskAndTranslate: 'הסתר ותרגם',
  focusMissing: 'התרגום בלוח. לחצי על השדה של Claude והדביקי',

  // Model
  modelUnavailable: 'המודל לא זמין למפתח. הריצי שוב את הגדרת המפתח.',
  overrideUnavailable: (_model: string): string => 'המודל שבהגדרה hebrewMode.model לא זמין למפתח.',
  noStableModel: (tier: string): string => `אין מודל ${tier === 'flash' ? 'Flash' : 'Flash-Lite'} יציב למפתח. אפשר לבחור מודל בהגדרות.`,

  // Flow
  disabled: 'התוסף כבוי בפרויקט הזה (hebrewMode.enabled). לא נשלח כלום.',
  alreadyHebrew: 'הטקסט בלוח כבר בעברית. לתרגום לאנגלית: Ctrl+Alt+E',
  routedToHebrew: 'הטקסט בלוח באנגלית, אז הוא מוצג בעברית בחלון התרגום.',
  nothingToTranslate: 'אין בטקסט מה לתרגם: יש בו רק קוד, נתיבים או פקודות. הלוח לא השתנה.',
  translatingToEnglish: 'מתרגם לאנגלית…',
  translatingToHebrew: 'מתרגם לעברית…',
  choosingModel: 'בוחר מודל Gemini…',
  englishReady: 'התרגום לאנגלית בלוח. Ctrl+V ואז Enter.',
  clipboardChanged: 'הלוח השתנה בזמן התרגום, אז התרגום לא נכתב אליו.',
  copyTranslation: 'העתיקי את התרגום',
  cancelled: 'התרגום בוטל. הלוח לא השתנה.',
  setupCancelled: 'לא הוגדר מפתח, ולכן התרגום לא בוצע. הלוח לא השתנה.',
  busy: 'תרגום אחר עדיין רץ. נסי שוב בעוד רגע.',
  unexpected: 'התרגום נכשל בגלל תקלה לא צפויה. הטקסט המקורי נשאר בלוח.',

  // Restore
  noDraft: 'אין טיוטה עברית שמורה. היא נשמרת כשמתרגמים לאנגלית עם Ctrl+Alt+E.',
  draftRestored: 'הטיוטה העברית חזרה ללוח.',
  draftRestoredNoFocus: 'הטיוטה העברית חזרה ללוח. לחצי על השדה של Claude והדביקי',

  // Panel
  panelTitle: 'תרגום לעברית',
  copy: 'העתקה',
  copied: 'הועתק',
  copiedStatus: 'התרגום לעברית הועתק ללוח.',

  // Key setup
  setupTitle: 'Hebrew Mode: הגדרת מפתח',
  setupPrompt: 'הדביקי כאן את מפתח Gemini מ-Google AI Studio. הדף נפתח בדפדפן.',
  setupNoSpaces: 'המפתח לא יכול להכיל רווחים',
  checkingKey: 'בודק את המפתח ובוחר מודל…',
  keyInvalidSetup: 'המפתח לא תקין. בדקי שהעתקת אותו במלואו ונסי שוב.',
  keyNetworkSetup: 'אין חיבור ל-Gemini לבדיקת המפתח. נסי שוב בעוד רגע.',
  keySaved: (model: string): string => `המפתח נשמר. מודל התרגום: ${model}`,
  keyNotSavedPrivacy: 'המפתח לא נשמר, כי הודעת הפרטיות לא אושרה.',

  // Privacy
  privacyTitle: 'Hebrew Mode: פרטיות',
  privacyText:
    'במסלול החינמי של Gemini, Google רשאית להשתמש בטקסט שנשלח לתרגום כדי לשפר את המוצרים שלה, ובודקים אנושיים עשויים לקרוא חלק ממנו (זה חל גם על משתמשים בישראל). ' +
    'לכן מומלץ לא לתרגם קוד או מידע של לקוחות במסלול החינמי. ' +
    'בלוקי קוד לא נשלחים בכלל, ושומר הסודות עוצר מפתחות לפני שליחה. אפשר לכבות את התוסף בפרויקט מסוים בהגדרה hebrewMode.enabled.',
  privacyAccept: 'הבנתי, אפשר להמשיך',
  cancel: 'ביטול',

  // Status bar
  statusTooltip: (count: number): string =>
    `Hebrew Mode: ${count} תרגומים היום (היום נספר לפי שעון הפסיפי, כמו המכסה של Gemini). לחיצה פותחת את ההגדרות.`,
  statusDisabledTooltip: 'Hebrew Mode כבוי בפרויקט הזה. לחיצה פותחת את ההגדרות.',
  glossaryInvalid: 'הקובץ .hebrew-mode.json לא תקין, ולכן המילון שבו לא נטען.',
} as const;
