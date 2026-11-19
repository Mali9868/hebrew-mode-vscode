import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { panelHtml } from './core/panelHtml';
import { rtlIsolate } from './core/bidi';
import { MESSAGES } from './core/messages';

/** Read-only side panel that shows the latest Hebrew translation. */
export class TranslationPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private text = '';

  show(hebrew: string): void {
    this.text = hebrew;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        'hebrewMode.translation',
        MESSAGES.panelTitle,
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        { enableScripts: true, enableFindWidget: true, localResourceRoots: [] },
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage(async (msg: unknown) => {
        if (typeof msg === 'object' && msg !== null && (msg as { type?: unknown }).type === 'copy') {
          await vscode.env.clipboard.writeText(this.text);
          vscode.window.setStatusBarMessage(rtlIsolate(MESSAGES.copiedStatus), 3000);
          void this.panel?.webview.postMessage({ type: 'copied' });
        }
      });
    } else {
      this.panel.reveal(vscode.ViewColumn.Beside, true);
    }
    this.panel.webview.html = panelHtml(hebrew, randomBytes(16).toString('base64'));
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
