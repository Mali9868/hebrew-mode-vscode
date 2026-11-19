/**
 * VS Code entry point. A thin adapter: all logic lives in core/app.ts.
 * Touch points with Claude Code: the clipboard and the claude-vscode.focus
 * command. Nothing else of Claude Code is read, changed or called.
 */
import * as vscode from 'vscode';
import { CLAUDE_FOCUS_COMMAND, Config, HebrewModeApp, Host, parseGlossaryFile } from './core/app';
import { GeminiService } from './core/geminiService';
import { rtlIsolate } from './core/bidi';
import { KEY_URL, MESSAGES } from './core/messages';
import { ModelTier } from './core/models';
import { TranslationPanel } from './panel';

const SECRET_KEY = 'hebrewMode.geminiApiKey';
const ENV_KEY = 'HEBREW_MODE_GEMINI_KEY';
const GLOSSARY_FILE = '.hebrew-mode.json';

class VsCodeHost implements Host {
  private warnedGlossary = false;
  countChanged?: (count: number) => void;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly panel: TranslationPanel,
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

  async progress<T>(title: string, task: () => Promise<T>): Promise<T> {
    return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => task());
  }

  showPanel(hebrew: string): void {
    this.panel.show(hebrew);
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
    this.item.command = { title: 'Hebrew Mode', command: 'workbench.action.openSettings', arguments: ['hebrewMode'] };
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

export function activate(context: vscode.ExtensionContext): void {
  const panel = new TranslationPanel();
  const host = new VsCodeHost(context, panel);
  const gemini = new GeminiService(() => host.getKey());
  const app = new HebrewModeApp(host, gemini);
  const status = new CounterStatus(app);
  host.countChanged = () => status.refresh();

  context.subscriptions.push(
    panel,
    status,
    vscode.commands.registerCommand('hebrewMode.translateToEnglish', () => app.translateToEnglish()),
    vscode.commands.registerCommand('hebrewMode.restoreHebrew', () => app.restoreHebrew()),
    vscode.commands.registerCommand('hebrewMode.translateToHebrew', () => app.translateToHebrew()),
    vscode.commands.registerCommand('hebrewMode.setApiKey', () => app.setApiKey()),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('hebrewMode')) status.refresh();
    }),
  );
}

export function deactivate(): void {
  // Nothing to clean up: the cache and the Hebrew draft live in memory only.
}
