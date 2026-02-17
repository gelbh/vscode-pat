const vscode = require('vscode');

/** @type {Map<string, vscode.WebviewPanel>} */
const previewPanels = new Map();

/**
 * Parse .pat file content into header info and data rows.
 * @returns {{ numInputs: number | null, numOutputs: number | null, numPatterns: number | null, rows: number[][] }}
 */
function parsePatContent(text) {
  const result = { numInputs: null, numOutputs: null, numPatterns: null, rows: [] };
  const lines = text.split(/\r?\n/);
  let inData = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('Number of ')) {
      const m = trimmed.match(/Number of (patterns|inputs|outputs)\s*=\s*(\d+)/);
      if (m) {
        const [, key, value] = m;
        const n = parseInt(value, 10);
        if (key === 'patterns') result.numPatterns = n;
        else if (key === 'inputs') result.numInputs = n;
        else if (key === 'outputs') result.numOutputs = n;
      }
      continue;
    }

    if (trimmed === '[Patterns]') {
      inData = true;
      continue;
    }

    if (inData) {
      const numbers = trimmed.split(/\s+/).map((s) => parseFloat(s, 10));
      if (numbers.length > 0 && numbers.every((n) => !Number.isNaN(n))) {
        result.rows.push(numbers);
      }
    }
  }

  return result;
}

/**
 * Build HTML for the table webview.
 */
function buildTableHtml(parsed, fileName) {
  const { numInputs, numOutputs, rows } = parsed;
  const numCols = rows[0]?.length ?? 0;
  const splitAt = numInputs != null && numOutputs != null ? numInputs : null;

  let headerCells = '';
  if (splitAt != null && splitAt > 0 && splitAt < numCols) {
    headerCells += `<th class="colgroup" colspan="${splitAt}" scope="colgroup">Inputs</th>`;
    headerCells += `<th class="colgroup output" colspan="${numCols - splitAt}" scope="colgroup">Outputs</th>`;
  } else {
    for (let c = 0; c < numCols; c++) {
      headerCells += `<th scope="col">C${c + 1}</th>`;
    }
  }

  let bodyRows = '';
  rows.forEach((row, i) => {
    const cells = row.map((val, c) => {
      const cls = [
        typeof val === 'number' && val >= 0 && val <= 1 && Number.isInteger(val) ? 'binary' : '',
        splitAt != null && c >= splitAt ? 'output' : ''
      ].filter(Boolean).join(' ');
      return `<td class="${cls}">${escapeHtml(String(val))}</td>`;
    }).join('');
    bodyRows += `<tr><th scope="row">${i + 1}</th>${cells}</tr>`;
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(fileName)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family, system-ui, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 1rem;
      overflow: auto;
    }
    h2 { margin: 0 0 0.75rem 0; font-weight: 600; font-size: 1rem; }
    table {
      border-collapse: collapse;
      table-layout: auto;
      width: max-content;
    }
    th, td {
      border: 1px solid var(--vscode-panel-border);
      padding: 0.25rem 0.5rem;
      text-align: right;
      white-space: nowrap;
    }
    th {
      background: var(--vscode-editor-inactiveSelectionBackground);
      font-weight: 600;
    }
    tbody tr:nth-child(even) { background: var(--vscode-editor-inactiveSelectionBackground); }
    tbody tr:hover { background: var(--vscode-list-hoverBackground); }
    td.binary { color: var(--vscode-editorWidget-foreground); }
    th:first-child { text-align: right; min-width: 2.5rem; }
    th.colgroup { text-align: center; }
    th.colgroup.output { background: color-mix(in srgb, var(--vscode-button-background) 25%, var(--vscode-editor-inactiveSelectionBackground)); }
    td.output { background: color-mix(in srgb, var(--vscode-button-background) 12%, var(--vscode-editor-background)); }
    tbody tr:nth-child(even) td.output { background: color-mix(in srgb, var(--vscode-button-background) 18%, var(--vscode-editor-inactiveSelectionBackground)); }
  </style>
</head>
<body>
  <h2>${escapeHtml(fileName)} — ${rows.length} pattern(s)</h2>
  <table>
    <thead><tr><th>#</th>${headerCells}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table>
</body>
</html>`;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Open or reveal PAT preview for the given document.
 * @param {vscode.ViewColumn} viewColumn
 */
function openOrRevealPreview(doc, viewColumn) {
  const uri = doc.uri.toString();
  const fileName = doc.fileName.split(/[/\\]/).pop() || 'patterns.pat';
  const text = doc.getText();
  const parsed = parsePatContent(text);

  if (parsed.rows.length === 0) {
    vscode.window.showInformationMessage('No pattern data found after [Patterns].');
    return;
  }

  let panel = previewPanels.get(uri);
  if (panel) {
    panel.reveal(viewColumn);
    panel.webview.html = buildTableHtml(parsed, fileName);
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'patPreview',
    `${fileName} (Preview)`,
    viewColumn,
    { enableScripts: false, retainContextWhenHidden: true }
  );

  panel.webview.html = buildTableHtml(parsed, fileName);

  const update = () => {
    if (!panel.visible) return;
    const newText = doc.getText();
    const next = parsePatContent(newText);
    panel.webview.html = buildTableHtml(next, fileName);
  };

  const sub = vscode.workspace.onDidChangeTextDocument((e) => {
    if (e.document === doc) update();
  });

  panel.onDidDispose(() => {
    sub.dispose();
    previewPanels.delete(uri);
  });

  previewPanels.set(uri, panel);
}

function activate(context) {
  const openPreview = vscode.commands.registerCommand('pat.openPreview', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'pat') {
      vscode.window.showWarningMessage('Open a .pat file first, then run "PAT: Open Preview" from the Command Palette or the editor title bar.');
      return;
    }
    openOrRevealPreview(editor.document, vscode.ViewColumn.Beside);
  });

  const openPreviewToSide = vscode.commands.registerCommand('pat.openPreviewToSide', () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'pat') {
      vscode.window.showWarningMessage('Open a .pat file first, then run "PAT: Open Preview to the Side" from the Command Palette or the editor title bar.');
      return;
    }
    openOrRevealPreview(editor.document, vscode.ViewColumn.Beside);
  });

  context.subscriptions.push(openPreview, openPreviewToSide);
}

function deactivate() {
  previewPanels.clear();
}

module.exports = { activate, deactivate };
