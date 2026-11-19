// Full end-to-end run of the packaged VSIX in a real VS Code workbench (code-server), driven by Playwright.
// The test harness extension (test/e2e/harness) answers Gemini requests from a mode file and stands in for
// claude-vscode.focus, so every flow and every failure-table row runs through the real UI.
//
// Usage: node run-e2e.js <workbench-url> <screenshots-dir> <harness-dir> <workspace-dir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [BASE, SHOTS, HARNESS_DIR, WORKSPACE] = process.argv.slice(2);
const MODE_FILE = path.join(HARNESS_DIR, 'mode.txt');
const LOG_FILE = path.join(HARNESS_DIR, 'harness-log.json');
const results = [];
const record = (name, pass, evidence) => {
  results.push({ name, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${evidence}`);
};
const setMode = (m) => fs.writeFileSync(MODE_FILE, m);
const harness = () => JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
const generateRequests = () => harness().requests.filter((r) => r.url.includes(':generateContent'));

const DRAFT = 'תוסיף בדיקות יחידה לפונקציה `getUserById()` בקובץ src/users.ts, ואז תריץ npm test -- --coverage. אל תשנה את הקוד הזה:\n\n```ts\nexport const LIMIT = 10;\n```';
const DRAFT_EN = 'Add unit tests for the `getUserById()` function in src/users.ts, then run npm test -- --coverage. Do not change this code:\n\n```ts\nexport const LIMIT = 10;\n```';
const ANSWER = 'I added three tests to `src/users.test.ts`. All of them pass:\n\n```bash\nnpm test -- --coverage\n```\n\nNext, consider handling the case where `id` is empty.';
const ANSWER_HE = 'הוספתי שלוש בדיקות ל-`src/users.test.ts`. כולן עוברות:\n\n```bash\nnpm test -- --coverage\n```\n\nבהמשך כדאי לטפל במקרה ש-`id` ריק.';

(async () => {
  setMode('ok');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 2 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.monaco-workbench', { timeout: 120000 });
  await page.waitForTimeout(7000);

  const setClipboard = (t) => page.evaluate((t) => navigator.clipboard.writeText(t), t);
  const getClipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const notes = async () => (await page.locator('.notification-list-item-message').allTextContents()).map((s) => s.trim());
  const dialogText = async () => (await page.locator('.monaco-dialog-box').allTextContents()).join(' ');
  const clickDialog = (label) => page.locator('.monaco-dialog-box').getByRole('button', { name: label }).first().click();
  const focusEditor = () => page.click('.monaco-workbench .part.editor', { position: { x: 200, y: 400 } }).catch(() => {});
  const press = async (keys, wait = 1500) => {
    await focusEditor();
    await page.keyboard.press(keys);
    await page.waitForTimeout(wait);
  };
  const clearNotes = async () => {
    await page.keyboard.press('Control+Shift+P');
    await page.keyboard.type('Notifications: Clear All Notifications');
    await page.waitForTimeout(600);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
  };
  const counterText = async () => (await page.locator('.statusbar-item:has(.codicon-arrow-swap)').first().textContent())?.trim();
  const statusBarText = async () => (await page.locator('.part.statusbar').textContent()) ?? '';
  const cancelOpenLinkDialog = async () => {
    const t = await dialogText();
    // VS Code asks before opening an external site. Escape answers "no" (notifications were read before).
    if (t.includes('aistudio.google.com')) await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    return t.includes('aistudio.google.com/api-keys');
  };

  // W. Welcome message once after installation, with key setup and guide buttons.
  const welcomeNotes = await notes();
  const welcomeButtons = (await page.locator('.notification-toast .monaco-button').allTextContents()).map((s) => s.trim());
  record('W1 welcome message after installation, with "set key" and "guide" buttons', welcomeNotes.some((m) => m.includes('התוסף Hebrew Mode מותקן')) && welcomeButtons.includes('הגדרת מפתח') && welcomeButtons.includes('מדריך'), JSON.stringify({ welcomeNotes, welcomeButtons }));
  await clearNotes();

  // A. First use: Ctrl+Alt+E with no key opens setup, privacy notice must be accepted, then the translation completes.
  await setClipboard(DRAFT);
  await press('Control+Alt+KeyE', 2500);
  const missingNote = await notes();
  const linkAsked = await cancelOpenLinkDialog();
  record('A1 first use opens setup: missing-key warning and AI Studio link', missingNote.some((m) => m.includes('לא הוגדר מפתח Gemini')) && linkAsked, JSON.stringify(missingNote));
  const promptText = (await page.locator('.quick-input-widget .quick-input-message').allTextContents()).join(' ');
  const linkButton = await page.locator('.quick-input-widget .codicon-link-external').count();
  record('K1 key input box shows where to create a key, with a button that opens the page', promptText.includes('https://aistudio.google.com/api-keys') && linkButton > 0, JSON.stringify({ promptText: promptText.slice(0, 160), linkButton }));
  await page.keyboard.type('harness-test-key');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.monaco-dialog-box', { timeout: 15000 });
  const privacy = await dialogText();
  await page.screenshot({ path: `${SHOTS}/privacy-notice.png` });
  record('A2 privacy notice shown on first run', privacy.includes('בודקים אנושיים') && privacy.includes('מומלץ לא לתרגם קוד או מידע של לקוחות'), privacy.slice(0, 160));
  await clickDialog('הבנתי, אפשר להמשיך');
  await page.waitForTimeout(3000);
  const afterSetup = await notes();
  record('A3 key saved and newest stable Flash-Lite picked', afterSetup.some((m) => m.includes('המפתח נשמר. מודל התרגום: gemini-2.5-flash-lite')), JSON.stringify(afterSetup));
  const english = await getClipboard();
  record('A4 English translation on the clipboard, code and paths unchanged', english === DRAFT_EN, JSON.stringify(english));
  record('A5 focus returned to Claude via claude-vscode.focus', harness().focus === 1, `focus calls: ${harness().focus}`);
  const sent = generateRequests();
  const body = sent[0]?.body ?? '';
  record(
    'A6 request: key only in x-goog-api-key, code block, inline code, path and command not sent',
    sent.length === 1 && sent[0].keyHeader === 'harness-test-key' && !sent[0].url.includes('harness-test-key') &&
      !body.includes('LIMIT') && !body.includes('getUserById') && !body.includes('src/users.ts') && !body.includes('npm test'),
    `url=${sent[0]?.url} body=${body.slice(0, 400)}`,
  );
  record('A7 status bar counter shows 1 translation today', (await counterText()) === '1', `counter="${await counterText()}"`);
  record('A8 status message tells to paste', (await statusBarText()).includes('התרגום לאנגלית בלוח'), 'status bar text checked');
  await clearNotes();

  // B. Ctrl+Alt+Z brings the Hebrew draft back.
  await press('Control+Alt+KeyZ');
  record('B1 Ctrl+Alt+Z restores the Hebrew draft', (await getClipboard()) === DRAFT, 'exact compare');

  // C. Ctrl+Alt+H shows Claude's answer in Hebrew in the side panel; clipboard untouched; copy button works.
  await setClipboard(ANSWER);
  await press('Control+Alt+KeyH', 3500);
  record('C1 clipboard untouched by Ctrl+Alt+H', (await getClipboard()) === ANSWER, 'exact compare');
  const tab = await page.locator('.tab:has-text("תרגום לעברית")').count();
  let frame = null;
  for (let i = 0; i < 20 && !frame; i++) {
    for (const f of page.frames()) if (await f.$('#copy').catch(() => null)) frame = f;
    if (!frame) await page.waitForTimeout(500);
  }
  const view = frame
    ? await frame.evaluate(() => ({
        dir: getComputedStyle(document.body).direction,
        pre: getComputedStyle(document.querySelector('pre')).direction,
        preFont: getComputedStyle(document.querySelector('pre')).fontFamily,
        code: getComputedStyle(document.querySelector('p code')).direction,
        text: document.querySelector('main').innerText,
      }))
    : null;
  record('C2 panel opened beside with the Hebrew translation', tab > 0 && !!view && view.text.includes('הוספתי שלוש בדיקות') && view.text.includes('npm test -- --coverage'), JSON.stringify(view && view.text.slice(0, 120)));
  record('C3 panel is RTL; code blocks and inline code are LTR and monospace', !!view && view.dir === 'rtl' && view.pre === 'ltr' && view.code === 'ltr' && /mono|Menlo|Consolas|Courier/i.test(view.preFont), JSON.stringify(view && { dir: view.dir, pre: view.pre, code: view.code, preFont: view.preFont }));
  await page.screenshot({ path: `${SHOTS}/panel-in-vscode.png` });
  if (frame) await frame.click('#copy');
  await page.waitForTimeout(1200);
  record('C4 copy button puts the Hebrew translation on the clipboard', (await getClipboard()) === ANSWER_HE, JSON.stringify(await getClipboard()));
  record('C5 counter shows 2', (await counterText()) === '2', `counter="${await counterText()}"`);

  // D. Ctrl+Alt+E on English text shows Hebrew instead (one shortcut, both directions) and leaves the clipboard.
  await setClipboard(ANSWER);
  await press('Control+Alt+KeyE', 2500);
  record('D1 Ctrl+Alt+E on English routes to the Hebrew panel, clipboard unchanged', (await getClipboard()) === ANSWER && (await statusBarText()).includes('הטקסט בלוח באנגלית'), 'status + clipboard checked');
  await clearNotes();

  // E. Failure table rows that need a Gemini response.
  const rows = [
    { mode: '429', expect: 'נסי שוב בעוד 12 שניות', name: 'E1 per-minute limit (429)' },
    { mode: 'daily', expect: 'המכסה היומית נגמרה. היא מתחדשת ב-20.11 בשעה 10:00 שעון ישראל', name: 'E2 daily quota with Israel time' },
    { mode: 'network', expect: 'התרגום נכשל', name: 'E3 network failure' },
    { mode: 'bad', expect: 'התרגום נכשל', name: 'E4 malformed response' },
    { mode: 'drop', expect: 'התרגום שינה קוד, בוטל', name: 'E5 placeholder dropped by the model' },
  ];
  let i = 0;
  for (const row of rows) {
    i++;
    setMode(row.mode);
    const text = `תתקן את הבאג בקובץ src/file${i}.ts`;
    await setClipboard(text);
    const before = generateRequests().length;
    await press('Control+Alt+KeyE', 3000);
    const n = await notes();
    const shown = n.find((m) => m.includes(row.expect));
    const attempts = generateRequests().length - before;
    record(`${row.name}: message shown, clipboard kept`, !!shown && (await getClipboard()) === text, `${JSON.stringify(n)} attempts=${attempts}`);
    if (row.mode === 'daily') await page.screenshot({ path: `${SHOTS}/daily-quota.png` });
    await clearNotes();
  }

  // E6. Invalid key at translation time opens setup; cancelling keeps the clipboard.
  setMode('invalid-key');
  await setClipboard('תתקן את הבאג בקובץ src/file9.ts');
  await press('Control+Alt+KeyE', 2500);
  const invalidNote = await notes();
  await cancelOpenLinkDialog();
  const setupOpen = (await page.locator('.quick-input-title').allTextContents()).join(' ').includes('הגדרת מפתח');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  record('E6 invalid key opens setup; cancel keeps the clipboard', invalidNote.some((m) => m.includes('מפתח Gemini לא תקין')) && setupOpen && (await getClipboard()) === 'תתקן את הבאג בקובץ src/file9.ts', JSON.stringify(invalidNote));
  await clearNotes();

  // E7. Gemini overloaded (503).
  setMode('503');
  await setClipboard('תתקן את הבאג בקובץ src/file10.ts');
  await press('Control+Alt+KeyE', 3000);
  const overloadNotes = await notes();
  record('E7 Gemini overloaded (503): clear "try again" message, clipboard kept', overloadNotes.some((m) => m.includes('השרתים של Gemini עמוסים כרגע')) && (await getClipboard()) === 'תתקן את הבאג בקובץ src/file10.ts', JSON.stringify(overloadNotes));
  await clearNotes();

  // E8. Cancel a slow translation from the progress notification.
  setMode('slow');
  await setClipboard('תתקן את הבאג בקובץ src/file11.ts');
  await press('Control+Alt+KeyE', 1500);
  const cancelButton = page.locator('.notification-toast .monaco-button', { hasText: 'Cancel' }).first();
  const hadCancel = (await cancelButton.count()) > 0;
  if (hadCancel) await cancelButton.click();
  await page.waitForTimeout(1500);
  record('E8 cancel button stops a slow translation; clipboard kept', hadCancel && (await statusBarText()).includes('התרגום בוטל') && (await getClipboard()) === 'תתקן את הבאג בקובץ src/file11.ts', `cancel button: ${hadCancel}`);
  await clearNotes();
  setMode('ok');

  // F. Secret guard: "Mask and translate" keeps the secret out of the request and restores it.
  setMode('ok');
  const secret = 'AIza' + 'SyD3m0Xk9QwErTy5UiOpAsDfGhJkLzXcVbN'.slice(0, 35);
  await setClipboard(`המפתח לבדיקה ${secret} שיעבוד`);
  await press('Control+Alt+KeyE', 2000);
  const secretDialog = await dialogText();
  await page.screenshot({ path: `${SHOTS}/secret-guard.png` });
  await clickDialog('הסתר ותרגם');
  await page.waitForTimeout(2500);
  const last = generateRequests().at(-1);
  record('F1 secret dialog shows the line without the secret', secretDialog.includes('שורה 1: Google API key') && !secretDialog.includes(secret), secretDialog.slice(0, 200));
  record('F2 masked secret not sent, restored in the English', !last.body.includes(secret) && (await getClipboard()) === `Check that the key ${secret} works.`, JSON.stringify(await getClipboard()));
  await clearNotes();

  // G. Project glossary file.
  fs.writeFileSync(path.join(WORKSPACE, '.hebrew-mode.json'), JSON.stringify({ glossary: ['Supabase'] }));
  await setClipboard('תעשה migration ב-Supabase');
  const beforeGlossary = generateRequests().length;
  await press('Control+Alt+KeyE', 2500);
  const gl = generateRequests().at(-1);
  const glEnglish = await getClipboard();
  record(
    'G1 short Hebrew instruction goes to English; glossary term from .hebrew-mode.json is not sent and stays as is',
    generateRequests().length === beforeGlossary + 1 && /Translate from Hebrew to English/.test(gl.body) && !gl.body.includes('Supabase') &&
      glEnglish.includes('Supabase') && !/\p{Script=Hebrew}/u.test(glEnglish),
    JSON.stringify(glEnglish),
  );
  fs.unlinkSync(path.join(WORKSPACE, '.hebrew-mode.json'));
  await clearNotes();

  // GD. The Hebrew guide inside VS Code.
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('Hebrew Mode: Show Guide');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  let guideFrame = null;
  for (let i = 0; i < 20 && !guideFrame; i++) {
    for (const f of page.frames()) if (await f.$('#setKey').catch(() => null)) guideFrame = f;
    if (!guideFrame) await page.waitForTimeout(500);
  }
  const guideView = guideFrame
    ? await guideFrame.evaluate(() => ({ dir: getComputedStyle(document.body).direction, text: document.querySelector('main').innerText, links: [...document.querySelectorAll('a')].map((a) => a.getAttribute('href')) }))
    : null;
  await page.screenshot({ path: `${SHOTS}/guide-in-vscode.png` });
  record(
    'GD1 guide opens right-to-left with usage steps, the key link and a key setup button',
    !!guideView && guideView.dir === 'rtl' && guideView.text.includes('איך משתמשים') && guideView.text.includes('איך משיגים מפתח API') && guideView.links.includes('https://aistudio.google.com/api-keys'),
    JSON.stringify(guideView && { dir: guideView.dir, chars: guideView.text.length, links: guideView.links }),
  );

  // H. Workspace setting turns the extension off for this project.
  fs.mkdirSync(path.join(WORKSPACE, '.vscode'), { recursive: true });
  fs.writeFileSync(path.join(WORKSPACE, '.vscode', 'settings.json'), JSON.stringify({ 'hebrewMode.enabled': false }));
  // VS Code picks up the settings file asynchronously: wait for the status bar to show the change.
  await page.waitForSelector('.statusbar-item:has(.codicon-circle-slash)', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const offIcon = await page.locator('.statusbar-item:has(.codicon-circle-slash)').count();
  const beforeOff = harness().requests.length;
  await setClipboard('תתקן את הבאג');
  await press('Control+Alt+KeyE');
  const offNote = await notes();
  record('H1 workspace setting disables sending; status bar shows it', offIcon > 0 && offNote.some((m) => m.includes('כבוי בפרויקט הזה')) && harness().requests.length === beforeOff, JSON.stringify(offNote));
  fs.rmSync(path.join(WORKSPACE, '.vscode'), { recursive: true, force: true });

  fs.writeFileSync(path.join(SHOTS, 'e2e-full-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('E2E ERROR', e);
  process.exit(2);
});
