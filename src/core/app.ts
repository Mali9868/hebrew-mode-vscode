/**
 * The four commands and their error handling, independent of VS Code.
 * Every side effect goes through `Host`, so each row of the SPEC.md failure
 * table can be unit tested with a fake host.
 *
 * Invariants:
 * - Nothing is ever sent to Claude. The only outputs are the clipboard, the
 *   translation panel, messages, and a request to focus Claude's input.
 * - The clipboard is written only after a translation fully succeeded, and
 *   only if it still holds the text that was translated. On any failure it
 *   keeps its original content.
 */
import { Direction, Span, detectDirection, hebrewRatio, protect } from './contentProtector';
import { TranslationError, isTranslationError } from './errors';
import { GeminiService } from './geminiService';
import { KEY_URL, MESSAGES } from './messages';
import { ModelTier } from './models';
import { SecretFinding, scanSecrets } from './secretGuard';
import { pacificDateKey } from './time';

export const CLAUDE_FOCUS_COMMAND = 'claude-vscode.focus';
export const STATE_PRIVACY = 'hebrewMode.privacyAccepted';
export const STATE_MODEL = 'hebrewMode.pickedModel';
export const STATE_COUNTER = 'hebrewMode.dailyCount';

/** Ctrl+Alt+H refuses text that is at least this Hebrew (it is already Hebrew). */
const ALREADY_HEBREW_RATIO = 0.5;

export interface Config {
  enabled: boolean;
  tier: ModelTier;
  /** Exact model id from settings, or '' to pick automatically. */
  modelOverride: string;
  glossary: string[];
}

export interface Host {
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  /** Non-blocking notifications. The promise resolves with the clicked action, possibly much later. */
  info(message: string, ...actions: string[]): Promise<string | undefined>;
  warn(message: string, ...actions: string[]): Promise<string | undefined>;
  error(message: string, ...actions: string[]): Promise<string | undefined>;
  /** Short-lived status bar message. */
  status(message: string): void;
  /** Modal dialog; true only when the confirm button was chosen. */
  confirm(kind: 'warning' | 'info', message: string, detail: string, confirmLabel: string): Promise<boolean>;
  progress<T>(title: string, task: () => Promise<T>): Promise<T>;
  showPanel(hebrew: string): void;
  /** Runs claude-vscode.focus. False when the command does not exist or failed. */
  focusClaude(): Promise<boolean>;
  openExternal(url: string): Promise<void>;
  /** Password input box. undefined when cancelled. */
  askApiKey(): Promise<string | undefined>;
  /** SecretStorage first, then the HEBREW_MODE_GEMINI_KEY environment variable. */
  getKey(): Promise<string | undefined>;
  storeKey(key: string): Promise<void>;
  getState<T>(key: string): T | undefined;
  setState(key: string, value: unknown): Promise<void>;
  config(): Promise<Config>;
  now(): Date;
  /** Called when the daily counter changes (status bar refresh). */
  countChanged?(count: number): void;
}

interface PickedModel {
  tier: ModelTier;
  model: string;
}

interface DayCount {
  day: string;
  count: number;
}

export class HebrewModeApp {
  private lastHebrew: string | undefined;
  private busy = false;
  private settingUp: Promise<boolean> | undefined;

  constructor(
    private readonly host: Host,
    private readonly gemini: GeminiService,
  ) {}

  // -------------------------------------------------------------------------
  // Commands

  /** Ctrl+Alt+E. Hebrew goes to English in the clipboard; English text is shown in Hebrew in the panel instead. */
  translateToEnglish(): Promise<void> {
    return this.exclusive(async () => {
      const ready = await this.readInput();
      if (!ready) return;
      const { text, cfg } = ready;
      if (detectDirection(text, cfg.glossary) === 'en-he') {
        this.host.status(MESSAGES.routedToHebrew);
        await this.toHebrew(text, cfg);
        return;
      }
      await this.toEnglish(text, cfg);
    });
  }

  /** Ctrl+Alt+H. English goes to Hebrew in the panel. The clipboard is never changed. */
  translateToHebrew(): Promise<void> {
    return this.exclusive(async () => {
      const ready = await this.readInput();
      if (!ready) return;
      if (hebrewRatio(ready.text, ready.cfg.glossary) >= ALREADY_HEBREW_RATIO) {
        void this.host.info(MESSAGES.alreadyHebrew);
        return;
      }
      await this.toHebrew(ready.text, ready.cfg);
    });
  }

  /** Ctrl+Alt+Z. Puts the last Hebrew draft back on the clipboard. */
  async restoreHebrew(): Promise<void> {
    if (this.lastHebrew === undefined) {
      void this.host.info(MESSAGES.noDraft);
      return;
    }
    await this.host.writeClipboard(this.lastHebrew);
    if (await this.host.focusClaude()) this.host.status(MESSAGES.draftRestored);
    else void this.host.info(MESSAGES.draftRestoredNoFocus);
  }

  /** "Hebrew Mode: Set API Key". Resolves true when a working key was stored. */
  setApiKey(): Promise<boolean> {
    // If setup is already open (for example a translation asked for it), join it.
    if (!this.settingUp) {
      this.settingUp = this.runSetup().finally(() => {
        this.settingUp = undefined;
      });
    }
    return this.settingUp;
  }

  get todayCount(): number {
    const saved = this.host.getState<DayCount>(STATE_COUNTER);
    return saved && saved.day === pacificDateKey(this.host.now()) ? saved.count : 0;
  }

  // -------------------------------------------------------------------------
  // Flows

  private async exclusive(task: () => Promise<void>): Promise<void> {
    if (this.busy) {
      this.host.status(MESSAGES.busy);
      return;
    }
    this.busy = true;
    try {
      await task();
    } catch {
      // A bug, not an expected failure. The clipboard was not touched; never show raw error text.
      void this.host.error(MESSAGES.unexpected);
    } finally {
      this.busy = false;
    }
  }

  private async readInput(): Promise<{ text: string; cfg: Config } | undefined> {
    const cfg = await this.host.config();
    if (!cfg.enabled) {
      void this.host.info(MESSAGES.disabled);
      return undefined;
    }
    const text = await this.host.readClipboard();
    if (text.trim() === '') {
      void this.host.info(MESSAGES.emptyClipboard);
      return undefined;
    }
    return { text, cfg };
  }

  private async toEnglish(hebrew: string, cfg: Config): Promise<void> {
    // Keep the draft before anything can fail, so Ctrl+Alt+Z always has the latest one.
    this.lastHebrew = hebrew;
    const english = await this.translate(hebrew, 'he-en', cfg);
    if (english === undefined) return;

    // Never overwrite something the user copied while the translation was running.
    const current = await this.host.readClipboard();
    if (current !== hebrew) {
      void this.host.warn(MESSAGES.clipboardChanged, MESSAGES.copyTranslation).then(async (choice) => {
        if (choice === MESSAGES.copyTranslation) await this.host.writeClipboard(english);
      });
      return;
    }
    await this.host.writeClipboard(english);
    if (await this.host.focusClaude()) this.host.status(MESSAGES.englishReady);
    else void this.host.info(MESSAGES.focusMissing);
  }

  private async toHebrew(english: string, cfg: Config): Promise<void> {
    const hebrew = await this.translate(english, 'en-he', cfg);
    if (hebrew !== undefined) this.host.showPanel(hebrew);
  }

  /** Returns the translation, or undefined after the failure was reported. Never touches the clipboard. */
  private async translate(text: string, direction: Direction, cfg: Config): Promise<string | undefined> {
    // 1. Secret guard, before anything leaves the machine.
    let extraSpans: Span[] = [];
    const secrets = scanSecrets(text);
    if (secrets.length > 0) {
      const mask = await this.host.confirm('warning', MESSAGES.secretFound, describeSecrets(secrets), MESSAGES.maskAndTranslate);
      if (!mask) {
        this.host.status(MESSAGES.cancelled);
        return undefined;
      }
      extraSpans = secrets;
    }

    // 2. Nothing but code: nothing to send.
    if (protect(text, { glossary: cfg.glossary, extraSpans, direction }).onlyProtected) {
      void this.host.info(MESSAGES.nothingToTranslate);
      return undefined;
    }

    // 3. Key and privacy notice.
    if (!(await this.ensureReady())) return undefined;

    // 4. Translate. A bad key opens setup and retries once; a retired auto-picked model is re-picked once.
    for (let attempt = 0; ; attempt++) {
      try {
        const model = await this.resolveModel(cfg);
        const title = direction === 'he-en' ? MESSAGES.translatingToEnglish : MESSAGES.translatingToHebrew;
        const result = await this.host.progress(title, () =>
          this.gemini.translate({ text, direction, model, glossary: cfg.glossary, extraSpans }),
        );
        if (result.sent) await this.countTranslation();
        return result.text;
      } catch (e) {
        if (attempt === 0 && isTranslationError(e, 'missingKey', 'invalidKey')) {
          void this.host.warn(e.message);
          if (await this.setApiKey()) continue;
          this.host.status(MESSAGES.setupCancelled);
          return undefined;
        }
        if (attempt === 0 && isTranslationError(e, 'modelUnavailable') && cfg.modelOverride === '') {
          await this.host.setState(STATE_MODEL, undefined);
          continue;
        }
        this.report(e, cfg);
        return undefined;
      }
    }
  }

  private report(e: unknown, cfg: Config): void {
    if (!(e instanceof TranslationError)) {
      void this.host.error(MESSAGES.failed);
      return;
    }
    switch (e.kind) {
      case 'rateLimitMinute':
      case 'quotaDaily':
        void this.host.warn(e.message);
        return;
      case 'modelUnavailable':
        void this.host.error(cfg.modelOverride ? MESSAGES.overrideUnavailable(cfg.modelOverride) : e.message);
        return;
      default:
        void this.host.error(e.message);
    }
  }

  private async ensureReady(): Promise<boolean> {
    const key = (await this.host.getKey())?.trim();
    if (!key) {
      void this.host.warn(MESSAGES.missingKey);
      if (!(await this.setApiKey())) {
        this.host.status(MESSAGES.setupCancelled);
        return false;
      }
    }
    if (!this.host.getState<boolean>(STATE_PRIVACY)) return this.askPrivacy();
    return true;
  }

  private async askPrivacy(): Promise<boolean> {
    const ok = await this.host.confirm('info', MESSAGES.privacyTitle, MESSAGES.privacyText, MESSAGES.privacyAccept);
    if (ok) await this.host.setState(STATE_PRIVACY, true);
    else this.host.status(MESSAGES.cancelled);
    return ok;
  }

  private async resolveModel(cfg: Config): Promise<string> {
    const override = cfg.modelOverride.trim().replace(/^models\//, '');
    if (override) return override;
    const saved = this.host.getState<PickedModel>(STATE_MODEL);
    if (saved && saved.tier === cfg.tier && saved.model) return saved.model;
    const model = await this.host.progress(MESSAGES.choosingModel, () => this.gemini.pickModel(cfg.tier));
    await this.host.setState(STATE_MODEL, { tier: cfg.tier, model } satisfies PickedModel);
    return model;
  }

  private async countTranslation(): Promise<void> {
    const day = pacificDateKey(this.host.now());
    const count = this.todayCount + 1;
    await this.host.setState(STATE_COUNTER, { day, count } satisfies DayCount);
    this.host.countChanged?.(count);
  }

  private async runSetup(): Promise<boolean> {
    await this.host.openExternal(KEY_URL);
    const entered = await this.host.askApiKey();
    const key = entered?.trim();
    if (!key) return false;

    const cfg = await this.host.config();
    let model: string;
    try {
      model = await this.host.progress(MESSAGES.checkingKey, () => this.gemini.pickModel(cfg.tier, key));
    } catch (e) {
      void this.host.error(setupErrorMessage(e));
      return false;
    }

    if (!this.host.getState<boolean>(STATE_PRIVACY)) {
      if (!(await this.askPrivacy())) {
        void this.host.info(MESSAGES.keyNotSavedPrivacy);
        return false;
      }
    }

    await this.host.storeKey(key);
    await this.host.setState(STATE_MODEL, { tier: cfg.tier, model } satisfies PickedModel);
    void this.host.info(MESSAGES.keySaved(cfg.modelOverride ? `${cfg.modelOverride} (לפי ההגדרות)` : model));
    return true;
  }
}

function describeSecrets(secrets: readonly SecretFinding[]): string {
  return [...secrets.map((s) => MESSAGES.secretLine(s.line, s.type, s.preview)), '', MESSAGES.secretExplain].join('\n');
}

function setupErrorMessage(e: unknown): string {
  if (isTranslationError(e, 'invalidKey')) return MESSAGES.keyInvalidSetup;
  if (isTranslationError(e, 'network', 'timeout')) return MESSAGES.keyNetworkSetup;
  if (e instanceof TranslationError) return e.message;
  return MESSAGES.keyNetworkSetup;
}

/** Parses the project glossary file (.hebrew-mode.json). Returns null when the file is invalid. */
export function parseGlossaryFile(text: string): string[] | null {
  try {
    const json = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
    const list = (json as { glossary?: unknown }).glossary;
    if (list === undefined) return [];
    if (!Array.isArray(list)) return null;
    return list.filter((t): t is string => typeof t === 'string' && t.trim() !== '').map((t) => t.trim());
  } catch {
    return null;
  }
}
