// Failure-table row "claude-vscode.focus does not exist" on the translate-to-English path, in a real VS Code
// workbench (code-server). Run with the harness extension and HEBREW_MODE_E2E_NO_FOCUS=1 in the server's environment.
// Usage: node run-e2e-no-focus.js <workbench-url> <harness-dir>
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [BASE, HARNESS_DIR] = process.argv.slice(2);
const DRAFT = 'תוסיף בדיקות יחידה לפונקציה `getUserById()` בקובץ src/users.ts, ואז תריץ npm test -- --coverage. אל תשנה את הקוד הזה:\n\n```ts\nexport const LIMIT = 10;\n```';
const DRAFT_EN = 'Add unit tests for the `getUserById()` function in src/users.ts, then run npm test -- --coverage. Do not change this code:\n\n```ts\nexport const LIMIT = 10;\n```';

(async () => {
  fs.writeFileSync(path.join(HARNESS_DIR, 'mode.txt'), 'ok');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.monaco-workbench', { timeout: 120000 });
  await page.waitForTimeout(7000);
  const notes = async () => (await page.locator('.notification-list-item-message').allTextContents()).map((s) => s.trim());
  await page.evaluate((t) => navigator.clipboard.writeText(t), DRAFT);
  await page.click('.monaco-workbench .part.editor', { position: { x: 200, y: 400 } }).catch(() => {});
  await page.keyboard.press('Control+Alt+KeyE');
  await page.waitForTimeout(2500);
  if ((await page.locator('.monaco-dialog-box').allTextContents()).join(' ').includes('aistudio.google.com')) await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  await page.keyboard.type('harness-test-key');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.monaco-dialog-box', { timeout: 15000 });
  await page.locator('.monaco-dialog-box').getByRole('button', { name: 'הבנתי, אפשר להמשיך' }).click();
  await page.waitForTimeout(3500);
  // Toasts can be hidden or limited; read the full list in the notification center.
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.type('Notifications: Show Notifications');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
  const n = await notes();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  const pass = clip === DRAFT_EN && n.some((m) => m.includes('התרגום בלוח. לחצי על השדה של Claude והדביקי'));
  console.log(`${pass ? 'PASS' : 'FAIL'} row 8 (no claude-vscode.focus): English on the clipboard and the hint shown :: ${JSON.stringify(n)} clipboard=${JSON.stringify(clip)}`);
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch((e) => {
  console.error('E2E ERROR', e);
  process.exit(2);
});
