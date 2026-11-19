// End-to-end check of the packaged VSIX in a real VS Code workbench (code-server), WITHOUT the test harness:
// no Claude Code installed (focus fallback path) and key validation against the real Gemini API (no key available).
// Usage: node run-e2e-real-api.js <workbench-url> <screenshots-dir>
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = process.argv[2];
const SHOTS = process.argv[3];
const results = [];
const record = (name, pass, evidence) => { results.push({ name, pass, evidence }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${evidence}`); };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  const popups = [];
  context.on('page', (p) => popups.push(p.url()));
  await page.goto(BASE);
  await page.waitForSelector('.monaco-workbench', { timeout: 120000 });
  await page.waitForTimeout(6000);

  // Trust dialog for the workspace, if shown.
  const trust = page.locator('button:has-text("Yes, I trust the authors")');
  if (await trust.count()) { await trust.first().click(); await page.waitForTimeout(1000); }

  const setClipboard = (t) => page.evaluate((t) => navigator.clipboard.writeText(t), t);
  const getClipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const notifications = async () => (await page.locator('.notification-list-item-message').allTextContents()).map((s) => s.trim());
  const clearNotifications = async () => { await page.keyboard.press('Escape'); await runCommand('Notifications: Clear All Notifications'); };
  async function runCommand(title) {
    await page.keyboard.press('Control+Shift+P');
    await page.waitForSelector('.quick-input-widget:not([style*="display: none"]) input');
    await page.keyboard.type(title);
    await page.waitForTimeout(700);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
  }
  async function focusEditorArea() { await page.click('.monaco-workbench .part.editor', { position: { x: 300, y: 300 } }).catch(() => {}); }

  // 1. Commands are registered with the expected titles.
  await page.keyboard.press('Control+Shift+P');
  await page.waitForSelector('.quick-input-widget input');
  await page.keyboard.type('Hebrew Mode');
  await page.waitForTimeout(1200);
  const items = (await page.locator('.quick-input-list .monaco-list-row').allTextContents()).map((s) => s.replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: `${SHOTS}/e2e-1-palette.png` });
  await page.keyboard.press('Escape');
  const titles = ['Translate to English', 'Restore Hebrew', 'Translate to Hebrew', 'Set API Key'];
  record('four commands registered', titles.every((t) => items.some((i) => i.includes(`Hebrew Mode: ${t}`))), JSON.stringify(items));

  // 2. Status bar counter is visible.
  const statusTexts = await page.locator('.statusbar-item').allTextContents();
  const statusHas = await page.locator('.statusbar-item[aria-label*="Hebrew Mode"], .statusbar-item .codicon-arrow-swap').count();
  record('status bar counter shown', statusHas > 0, `matching items: ${statusHas}`);

  // 3. Empty clipboard + Ctrl+Alt+E (real keybinding).
  await setClipboard('');
  await focusEditorArea();
  await page.keyboard.press('Control+Alt+KeyE');
  await page.waitForTimeout(1500);
  let n = await notifications();
  record('empty clipboard message via Ctrl+Alt+E', n.some((m) => m.includes('העתיקי קודם את הטקסט')), JSON.stringify(n));
  await page.screenshot({ path: `${SHOTS}/e2e-2-empty.png` });
  await clearNotifications();

  // 4. Secret guard: modal with line number, cancel sends nothing, clipboard unchanged.
  const secret = 'AIza' + 'SyD3m0Xk9QwErTy5UiOpAsDfGhJkLzXcVbN'.slice(0, 35);
  const secretText = `שורה ראשונה\nתבדוק את המפתח ${secret} בבקשה`;
  await setClipboard(secretText);
  await focusEditorArea();
  await page.keyboard.press('Control+Alt+KeyE');
  await page.waitForSelector('.monaco-dialog-box', { timeout: 10000 }).catch(() => {});
  const dialogText = (await page.locator('.monaco-dialog-box').allTextContents()).join(' ');
  await page.screenshot({ path: `${SHOTS}/e2e-3-secret.png` });
  record('secret guard dialog shows the line, hides the secret', /שורה 2: Google API key/.test(dialogText) && !dialogText.includes(secret) && dialogText.includes('הסתר ותרגם'), dialogText.slice(0, 300));
  await page.locator('.monaco-dialog-box button:has-text("ביטול")').click().catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(800);
  record('clipboard unchanged after cancelling the secret dialog', (await getClipboard()) === secretText, 'compared exact text');
  await clearNotifications();

  // 5. Missing key: Ctrl+Alt+E opens setup (password box); a wrong key is validated against the real Gemini API.
  const hebrew = 'תוסיף בדיקות לקובץ src/app.ts ותריץ `npm test`';
  await setClipboard(hebrew);
  await focusEditorArea();
  await page.keyboard.press('Control+Alt+KeyE');
  await page.waitForTimeout(2500);
  const earlyNotes = await notifications(); // read before Escape, which hides toasts
  // VS Code asks before opening an external link; cancel it (we only check that it was requested).
  const openDialog = (await page.locator('.monaco-dialog-box').allTextContents()).join(' ');
  const askedToOpen = openDialog.includes('aistudio.google.com');
  if (await page.locator('.monaco-dialog-box').count()) await page.locator('.monaco-dialog-box button:has-text("Cancel")').click().catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(1000);
  const input = page.locator('.quick-input-widget input');
  const inputType = await input.getAttribute('type').catch(() => null);
  const quickTitle = (await page.locator('.quick-input-title').allTextContents()).join(' ');
  await page.screenshot({ path: `${SHOTS}/e2e-4-setup.png` });
  record('missing key opens Set API Key with a password field', inputType === 'password' && quickTitle.includes('הגדרת מפתח'), `type=${inputType} title=${quickTitle}`);
  record('setup asks to open https://aistudio.google.com/api-keys', askedToOpen || popups.some((u) => u.includes('aistudio.google.com/api-keys')), askedToOpen ? 'VS Code open-link dialog for aistudio.google.com' : JSON.stringify(popups));
  record('missing key warning shown', earlyNotes.some((m) => m.includes('לא הוגדר מפתח Gemini')), JSON.stringify(earlyNotes));
  await page.keyboard.type('AIza' + 'SyThisIsNotARealKey'.padEnd(35, '0')); // fake, built at runtime
  await page.keyboard.press('Enter');
  await page.waitForTimeout(6000);
  n = await notifications();
  await page.screenshot({ path: `${SHOTS}/e2e-5-invalid-key.png` });
  record('invalid key rejected by the real Gemini API with a clear message', n.some((m) => m.includes('המפתח לא תקין')), JSON.stringify(n));
  record('no key text in any message', !n.some((m) => m.includes('ThisIsNotARealKey')), 'checked all notifications');
  record('clipboard still holds the Hebrew after the failed setup', (await getClipboard()) === hebrew, 'compared exact text');
  await clearNotifications();

  // 6. Ctrl+Alt+Z restores the Hebrew draft.
  await setClipboard('something else');
  await focusEditorArea();
  await page.keyboard.press('Control+Alt+KeyZ');
  await page.waitForTimeout(1500);
  n = await notifications();
  record('Ctrl+Alt+Z restores the Hebrew draft', (await getClipboard()) === hebrew, `clipboard restored; messages=${JSON.stringify(n)}`);
  record('without Claude Code installed, the focus fallback message is shown', n.some((m) => m.includes('לחצי על השדה של Claude והדביקי')), JSON.stringify(n));
  await clearNotifications();

  // 7. Ctrl+Alt+H on Hebrew text explains instead of translating.
  await focusEditorArea();
  await page.keyboard.press('Control+Alt+KeyH');
  await page.waitForTimeout(1500);
  n = await notifications();
  record('Ctrl+Alt+H on Hebrew text explains it is already Hebrew', n.some((m) => m.includes('כבר בעברית')), JSON.stringify(n));
  await clearNotifications();

  // 8. Code-only text is never sent.
  await setClipboard('```ts\nconst a = 1;\n```');
  await focusEditorArea();
  await page.keyboard.press('Control+Alt+KeyH');
  await page.waitForTimeout(1500);
  n = await notifications();
  record('code-only text: nothing to translate, nothing sent', n.some((m) => m.includes('אין בטקסט מה לתרגם')), JSON.stringify(n));

  fs.writeFileSync(`${SHOTS}/e2e-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(results.every((r) => r.pass) ? 0 : 1);
})().catch((e) => { console.error('E2E ERROR', e); process.exit(2); });
