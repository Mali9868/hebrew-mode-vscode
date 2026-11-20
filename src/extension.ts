/**
 * VS Code entry point. A thin adapter: all logic lives in core/app.ts.
 * Touch points with Claude Code: the clipboard and the claude-vscode.focus
 * command. Nothing else of Claude Code is read, changed or called.
 */
import * as vscode from 'vscode';
import { CLAUDE_FOCUS_COMMAND, Config, HebrewModeApp, Host, parseGlossaryFile } from './core/app';
import { GeminiService } from './core/geminiService';
import { addGlossaryTerm } from './core/glossary';
import { rtlIsolate } from './core/bidi';
import { KEY_URL, MESSAGES } from './core/messages';
import { ModelTier } from './core/models';
import { GuidePanel, TranslationPanel } from './panel';

const SECRET_KEY = 'hebrewMode.geminiApiKey';
const ENV_KEY = 'HEBREW_MODE_GEMINI_KEY';
const GLOSSARY_FILE = '.hebrew-mode.json';

class VsCodeHost implements Host {
  private warnedGlossary = false;
  countChanged?: (count: number) => void;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly panel: TranslationPanel,
    private readonly guide: GuidePanel,
  ) {}

  async readClipboard(): Promise<string> {
    return vscode.env.clipboard.readText();
  }

  async writeClipboard(text: string): Promise<void> {
    await vscode.env.clipboard.writeText(text);
  }

  async info(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showInformationMessage(rtlIsolate(message), ...actions);
  }

  async warn(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showWarningMessage(rtlIsolate(message), ...actions);
  }

  async error(message: string, ...actions: string[]): Promise<string | undefined> {
    return vscode.window.showErrorMessage(rtlIsolate(message), ...actions);
  }

  status(message: string): void {
    vscode.window.setStatusBarMessage(rtlIsolate(message), 5000);
  }

  async confirm(kind: 'warning' | 'info', message: string, detail: string, confirmLabel: string): Promise<boolean> {
    const ok: vscode.MessageItem = { title: confirmLabel };
    const cancel: vscode.MessageItem = { title: MESSAGES.cancel, isCloseAffordance: true };
    const show = kind === 'warning' ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const choice = await show(rtlIsolate(message), { modal: true, detail: rtlIsolate(detail) }, ok, cancel);
    return choice === ok;
  }

  async progress<T>(title: string, task: (cancel: AbortSignal) => Promise<T>): Promise<T> {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: true }, (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      return task(controller.signal);
    });
  }

  showPanel(hebrew: string): void {
    this.panel.show(hebrew);
  }

  async showGuide(): Promise<void> {
    let guide: string = MESSAGES.guideMissing;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(this.ctx.extensionUri, 'build', 'guide.md'));
      guide = new TextDecoder().decode(bytes);
    } catch {
      // Not built (development without packaging): show the short fallback text.
    }
    this.guide.show(guide);
  }

  async focusClaude(): Promise<boolean> {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(CLAUDE_FOCUS_COMMAND)) return false;
    try {
      await vscode.commands.executeCommand(CLAUDE_FOCUS_COMMAND);
      return true;
    } catch {
      return false;
    }
  }

  async openExternal(url: string): Promise<void> {
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /** Password input box with a title-bar button that opens the page where a key is created. */
  askApiKey(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const box = vscode.window.createInputBox();
      const openPage: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('link-external'), tooltip: MESSAGES.openKeyPage };
      box.title = MESSAGES.setupTitle;
      box.prompt = rtlIsolate(MESSAGES.setupPrompt);
      box.placeholder = 'AIza...';
      box.password = true;
      box.ignoreFocusOut = true;
      box.buttons = [openPage];
      let done = false;
      const finish = (value: string | undefined): void => {
        if (done) return;
        done = true;
        resolve(value);
        box.dispose();
      };
      box.onDidTriggerButton(() => void vscode.env.openExternal(vscode.Uri.parse(KEY_URL)));
      box.onDidChangeValue((value) => {
        box.validationMessage = /\s/.test(value.trim()) ? rtlIsolate(MESSAGES.setupNoSpaces) : undefined;
      });
      box.onDidAccept(() => {
        if (!box.validationMessage) finish(box.value);
      });
      box.onDidHide(() => finish(undefined));
      box.show();
    });
  }

  async getKey(): Promise<string | undefined> {
    const stored = await this.ctx.secrets.get(SECRET_KEY);
    if (stored && stored.trim()) return stored;
    const fromEnv = process.env[ENV_KEY];
    return fromEnv && fromEnv.trim() ? fromEnv : undefined;
  }

  async storeKey(key: string): Promise<void> {
    await this.ctx.secrets.store(SECRET_KEY, key);
  }
  async hasStoredKey(): Promise<boolean> {
    const stored = await this.ctx.secrets.get(SECRET_KEY);
    return !!stored && stored.trim() !== '';
  }

  async deleteKey(): Promise<void> {
    await this.ctx.secrets.delete(SECRET_KEY);
  }

  hasEnvKey(): boolean {
    const fromEnv = process.env[ENV_KEY];
    return !!fromEnv && fromEnv.trim() !== '';
  }


  getState<T>(key: string): T | undefined {
    return this.ctx.globalState.get<T>(key);
  }

  async setState(key: string, value: unknown): Promise<void> {
    await this.ctx.globalState.update(key, value);
  }

  async config(): Promise<Config> {
    const c = vscode.workspace.getConfiguration('hebrewMode');
    const tier = c.get<string>('modelTier', 'flash-lite') === 'flash' ? 'flash' : 'flash-lite';
    return {
      enabled: c.get<boolean>('enabled', true),
      tier: tier satisfies ModelTier,
      modelOverride: (c.get<string>('model', '') ?? '').trim(),
      focusClaude: c.get<boolean>('focusClaude', true),
      glossary: [...new Set([...(c.get<string[]>('glossary', []) ?? []), ...(await this.projectGlossary())])],
    };
  }

  now(): Date {
    return new Date();
  }

  /** Reads .hebrew-mode.json from each workspace folder root. */
  private async projectGlossary(): Promise<string[]> {
    const terms: string[] = [];
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      const uri = vscode.Uri.joinPath(folder.uri, GLOSSARY_FILE);
      let bytes: Uint8Array;
      try {
        bytes = await vscode.workspace.fs.readFile(uri);
      } catch {
        continue; // no glossary file in this folder
      }
      const parsed = parseGlossaryFile(new TextDecoder().decode(bytes));
      if (parsed) terms.push(...parsed);
      else if (!this.warnedGlossary) {
        this.warnedGlossary = true;
        void vscode.window.showWarningMessage(rtlIsolate(MESSAGES.glossaryInvalid));
      }
    }
    return terms;
  }
}

class CounterStatus implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly app: HebrewModeApp) {
    this.item.command = { title: 'Hebrew Mode', command: 'hebrewMode.showMenu' };
    this.refresh();
    this.item.show();
    // Pick up the Pacific-midnight reset without user action.
    this.timer = setInterval(() => this.refresh(), 5 * 60 * 1000);
  }

  refresh(): void {
    const enabled = vscode.workspace.getConfiguration('hebrewMode').get<boolean>('enabled', true);
    if (enabled) {
      const count = this.app.todayCount;
      this.item.text = `$(arrow-swap) ${count}`;
      this.item.tooltip = MESSAGES.statusTooltip(count);
    } else {
      this.item.text = '$(circle-slash) Hebrew Mode';
      this.item.tooltip = MESSAGES.statusDisabledTooltip;
    }
  }

  dispose(): void {
    clearInterval(this.timer);
    this.item.dispose();
  }
}

/** The status bar menu: every action in one place, so nobody has to remember the shortcuts. */
async function showMenu(): Promise<void> {
  const mac = process.platform === 'darwin';
  const key = (letter: string): string => (mac ? `Control+Option+${letter}` : `Ctrl+Alt+${letter}`);
  const items: Array<vscode.QuickPickItem & { command: string; args?: unknown[] }> = [
    { label: `$(arrow-swap) ${MESSAGES.menuToEnglish}`, description: key('E'), command: 'hebrewMode.translateToEnglish' },
    { label: `$(preview) ${MESSAGES.menuToHebrew}`, description: key('H'), command: 'hebrewMode.translateToHebrew' },
    { label: `$(history) ${MESSAGES.menuRestore}`, description: key('Z'), command: 'hebrewMode.restoreHebrew' },
    { label: `$(book) ${MESSAGES.menuGuide}`, command: 'hebrewMode.showGuide' },
    { label: `$(add) ${MESSAGES.menuGlossary}`, command: 'hebrewMode.addToGlossary' },
    { label: `$(key) ${MESSAGES.menuSetKey}`, command: 'hebrewMode.setApiKey' },
    { label: `$(trash) ${MESSAGES.menuRemoveKey}`, command: 'hebrewMode.removeApiKey' },
    { label: `$(settings-gear) ${MESSAGES.menuSettings}`, command: 'workbench.action.openSettings', args: ['hebrewMode'] },
  ];
  const pick = await vscode.window.showQuickPick(items, { title: 'Hebrew Mode', placeHolder: MESSAGES.menuPlaceholder });
  if (pick) await vscode.commands.executeCommand(pick.command, ...(pick.args ?? []));
}

/** "Hebrew Mode: Add to Glossary". Adds a term to the personal or the project glossary setting. */
async function addToGlossary(host: VsCodeHost): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection).trim() : '';
  const term = await vscode.window.showInputBox({
    title: MESSAGES.glossaryTitle,
    prompt: rtlIsolate(MESSAGES.glossaryPrompt),
    value: addGlossaryTerm([], selected).ok ? selected : '',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const result = addGlossaryTerm([], value);
      return result.ok || result.reason === 'empty' ? undefined : rtlIsolate(MESSAGES.glossaryInvalidTerm);
    },
  });
  if (!term || term.trim() === '') return;

  let target = vscode.ConfigurationTarget.Global;
  if (vscode.workspace.workspaceFolders?.length) {
    const choice = await vscode.window.showQuickPick(
      [
        { label: MESSAGES.glossaryGlobal, target: vscode.ConfigurationTarget.Global },
        { label: MESSAGES.glossaryWorkspace, target: vscode.ConfigurationTarget.Workspace },
      ],
      { title: MESSAGES.glossaryTitle, placeHolder: MESSAGES.glossaryWhere },
    );
    if (!choice) return;
    target = choice.target;
  }

  const config = vscode.workspace.getConfiguration('hebrewMode');
  const inspected = config.inspect<string[]>('glossary');
  const current = (target === vscode.ConfigurationTarget.Global ? inspected?.globalValue : inspected?.workspaceValue) ?? [];
  const result = addGlossaryTerm(current, term);
  if (!result.ok) {
    void host.info(result.reason === 'duplicate' ? MESSAGES.glossaryDuplicate : MESSAGES.glossaryInvalidTerm);
    return;
  }
  await config.update('glossary', result.list, target);
  void host.info(MESSAGES.glossaryAdded(result.term));
}

export function activate(context: vscode.ExtensionContext): void {
  const panel = new TranslationPanel();
  const guide = new GuidePanel();
  const host = new VsCodeHost(context, panel, guide);
  const gemini = new GeminiService(() => host.getKey());
  const app = new HebrewModeApp(host, gemini);
  const status = new CounterStatus(app);
  host.countChanged = () => status.refresh();

  context.subscriptions.push(
    panel,
    guide,
    status,
    vscode.commands.registerCommand('hebrewMode.translateToEnglish', () => app.translateToEnglish()),
    vscode.commands.registerCommand('hebrewMode.restoreHebrew', () => app.restoreHebrew()),
    vscode.commands.registerCommand('hebrewMode.translateToHebrew', () => app.translateToHebrew()),
    vscode.commands.registerCommand('hebrewMode.setApiKey', () => app.setApiKey()),
    vscode.commands.registerCommand('hebrewMode.showGuide', () => host.showGuide()),
    vscode.commands.registerCommand('hebrewMode.removeApiKey', () => app.removeApiKey()),
    vscode.commands.registerCommand('hebrewMode.addToGlossary', () => addToGlossary(host)),
    vscode.commands.registerCommand('hebrewMode.showMenu', () => showMenu()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('hebrewMode')) status.refresh();
    }),
  );
  void app.welcome();
}

export function deactivate(): void {
  // Nothing to clean up: the cache and the Hebrew draft live in memory only.
}
