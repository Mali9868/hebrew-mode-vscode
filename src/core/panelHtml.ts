/**
 * HTML for the read-only translation panel. Right-to-left Hebrew text,
 * left-to-right monospace code, one copy button. A strict Content Security
 * Policy allows only this page's own nonce-tagged style and script: no
 * remote resources, no images, no other scripts.
 */
import { MESSAGES } from './messages';
import { renderMarkdown, escapeHtml } from './markdown';

/** The toolbar button: copy in the translation panel, key setup in the guide. */
export interface PanelAction {
  id: string;
  label: string;
  /** Shown for a moment after the extension confirms the action. */
  doneLabel?: string;
}

export const COPY_ACTION: PanelAction = { id: 'copy', label: MESSAGES.copy, doneLabel: MESSAGES.copied };

/** JSON for an inline script: "<" is escaped so a value can never close the script tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).split('<').join(String.fromCharCode(92) + 'u003c');
}

export function panelHtml(hebrewMarkdown: string, nonce: string, action: PanelAction = COPY_ACTION): string {
  const csp = `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';`;
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(MESSAGES.panelTitle)}</title>
<style nonce="${nonce}">
  body {
    direction: rtl;
    text-align: right;
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    line-height: 1.65;
    padding: 0 16px 32px;
    margin: 0;
  }
  .toolbar {
    position: sticky;
    top: 0;
    display: flex;
    justify-content: flex-start;
    padding: 10px 0;
    background: var(--vscode-editor-background);
    border-bottom: 1px solid var(--vscode-panel-border, transparent);
  }
  button {
    font: inherit;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: none;
    border-radius: 2px;
    padding: 4px 14px;
    cursor: pointer;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  main { max-width: 860px; }
  pre {
    direction: ltr;
    text-align: left;
    unicode-bidi: isolate;
    font-family: var(--vscode-editor-font-family);
    font-size: var(--vscode-editor-font-size);
    background: var(--vscode-textCodeBlock-background);
    padding: 10px 12px;
    border-radius: 4px;
    overflow-x: auto;
    white-space: pre;
  }
  code {
    direction: ltr;
    unicode-bidi: isolate;
    font-family: var(--vscode-editor-font-family);
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px;
    border-radius: 3px;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    margin: 0;
    padding-inline-start: 12px;
    border-inline-start: 3px solid var(--vscode-textBlockQuote-border);
    color: var(--vscode-textBlockQuote-foreground, inherit);
  }
  table { border-collapse: collapse; margin: 8px 0; }
  th, td { border: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35)); padding: 4px 10px; }
  a { color: var(--vscode-textLink-foreground); }
  hr { border: none; border-top: 1px solid var(--vscode-panel-border, rgba(128, 128, 128, 0.35)); }
</style>
</head>
<body>
<div class="toolbar"><button id="${escapeHtml(action.id)}" type="button">${escapeHtml(action.label)}</button></div>
<main id="content">
${renderMarkdown(hebrewMarkdown)}
</main>
<script nonce="${nonce}">
  (function () {
    const vscode = acquireVsCodeApi();
    const id = ${scriptJson(action.id)};
    const button = document.getElementById(id);
    const label = ${scriptJson(action.label)};
    const done = ${scriptJson(action.doneLabel ?? '')};
    button.addEventListener('click', function () { vscode.postMessage({ type: id }); });
    window.addEventListener('message', function (event) {
      if (done && event.data && event.data.type === 'done') {
        button.textContent = done;
        setTimeout(function () { button.textContent = label; }, 1500);
      }
    });
  })();
</script>
</body>
</html>`;
}
