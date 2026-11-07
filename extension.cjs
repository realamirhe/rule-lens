const vscode = require('vscode');
const { execFile } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { readConfig } = require('./scanner.cjs');
const { errorChain } = require('./runtime.cjs');
const {
  parseJson,
  processContext,
  processFailure,
  resolveExecution,
  terminate,
} = require('./runner.cjs');

const configName = 'rule-lens.json';
const cliPath = path.join(__dirname, 'cli.cjs');

function inside(directory, file) {
  const relative = path.relative(directory, file);
  return Boolean(
    relative &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative)
  );
}

function resolveRelative(directory, relative) {
  if (
    typeof relative !== 'string' ||
    (path.sep === '\\' && relative.includes('\\')) ||
    relative.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('Expected a canonical workspace-relative path');
  }
  const file = path.resolve(directory, relative);
  if (!inside(directory, file)) {
    throw new Error('Report path escapes the workspace folder');
  }
  return file;
}

function readReport(root, stdout) {
  let report;
  try {
    report = parseJson(stdout);
  } catch (cause) {
    throw cause;
  }
  if (
    report?.schemaVersion !== 1 ||
    !Array.isArray(report.findings) ||
    !Array.isArray(report.rules) ||
    !Number.isSafeInteger(report.scannedFiles) ||
    report.scannedFiles < 0
  ) {
    throw new Error('Invalid RuleLens report');
  }

  const scope = resolveRelative(root, report.scope);
  const guidance = new Map();
  for (const rule of report.rules) {
    if (typeof rule?.id !== 'string' || typeof rule.guidance !== 'string') {
      throw new Error('Invalid rule in RuleLens report');
    }
    guidance.set(rule.id, rule.guidance);
  }

  const files = new Map();
  for (const finding of report.findings) {
    const file = resolveRelative(root, finding?.file);
    if (
      !inside(scope, file) ||
      !guidance.has(finding.ruleId) ||
      !['error', 'warning'].includes(finding.severity) ||
      !Number.isSafeInteger(finding.line) ||
      finding.line < 1 ||
      !Number.isSafeInteger(finding.column) ||
      finding.column < 1 ||
      typeof finding.message !== 'string'
    ) {
      throw new Error('Invalid finding in RuleLens report');
    }
    const item = { ...finding, guidance: guidance.get(finding.ruleId) };
    const current = files.get(file);
    if (current) current.push(item);
    else files.set(file, [item]);
  }

  return { scope, files, scannedFiles: report.scannedFiles };
}

function findingRange(item, document) {
  const line = item.line - 1;
  const column = item.column - 1;
  const rawEndLine = Number.isSafeInteger(item.endLine) ? item.endLine - 1 : line;
  const rawEndColumn = Number.isSafeInteger(item.endColumn) ? item.endColumn - 1 : column + 1;
  if (!document) return new vscode.Range(line, column, rawEndLine, rawEndColumn);
  const start = document.validatePosition(new vscode.Position(line, column));
  if (Number.isSafeInteger(item.endLine) && Number.isSafeInteger(item.endColumn)) {
    const end = document.validatePosition(new vscode.Position(rawEndLine, rawEndColumn));
    return new vscode.Range(start, end);
  }
  const text = document.lineAt(start.line).text;
  const width = text.codePointAt(start.character) > 0xffff ? 2 : 1;
  const end = document.validatePosition(start.translate(0, width));
  return new vscode.Range(start, end);
}

function activate(context) {
  const diagnostics = vscode.languages.createDiagnosticCollection('rule-lens');
  const output = vscode.window.createOutputChannel('RuleLens');
  const decoration = (severity) =>
    vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.file(path.join(__dirname, 'media', `${severity}.svg`)),
      gutterIconSize: 'contain',
      overviewRulerColor: new vscode.ThemeColor(`editor${severity === 'error' ? 'Error' : 'Warning'}.foreground`),
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
  const errorDecoration = decoration('error');
  const warningDecoration = decoration('warning');
  const folders = new Map();

  function stateFor(uri) {
    if (!vscode.workspace.isTrusted || uri?.scheme !== 'file') return undefined;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    return folder && folders.get(folder.uri.fsPath);
  }

  function itemsFor(document) {
    const state = stateFor(document.uri);
    return (!document.isDirty && state?.files.get(document.uri.fsPath)) || [];
  }

  function paint() {
    for (const editor of vscode.window.visibleTextEditors) {
      const document = editor.document;
      const lines = new Map();
      for (const item of itemsFor(document)) {
        const line = findingRange(item, document).start.line;
        const items = lines.get(line);
        if (items) items.push(item);
        else lines.set(line, [item]);
      }

      const errors = [];
      const warnings = [];
      for (const [line, items] of lines) {
        const error = items.find((item) => item.severity === 'error');
        const first = error || items[0];
        const hover = new vscode.MarkdownString();
        hover.appendMarkdown('**RuleLens**\n\n');
        for (const item of items) {
          hover.appendText(`[${item.ruleId}] ${item.message}`);
          if (item.guidance) {
            hover.appendMarkdown('\n\n');
            hover.appendText(item.guidance);
          }
          hover.appendMarkdown('\n\n');
        }
        const summary = `${first.ruleId}: ${first.message}`.replace(/\s+/g, ' ');
        const short = summary.length > 120 ? `${summary.slice(0, 117)}...` : summary;
        const more = items.length > 1 ? ` (+${items.length - 1} more)` : '';
        const option = {
          range: document.lineAt(line).range,
          hoverMessage: hover,
          renderOptions: {
            after: {
              contentText: `  ${short}${more}`,
              color: new vscode.ThemeColor(error ? 'editorError.foreground' : 'editorWarning.foreground'),
              margin: '0 0 0 1em',
            },
          },
        };
        (error ? errors : warnings).push(option);
      }
      editor.setDecorations(errorDecoration, errors);
      editor.setDecorations(warningDecoration, warnings);
    }
  }

  function removeFindings(state) {
    for (const file of state.files.keys()) diagnostics.delete(vscode.Uri.file(file));
    state.files.clear();
  }

  function cancel(state) {
    clearTimeout(state.timer);
    state.generation += 1;
    terminate(state.child);
    state.child = undefined;
  }

  function fail(state, failure, manual) {
    removeFindings(state);
    state.status = 'failed';
    output.appendLine(`[${state.root}] ${errorChain(failure)}`);
    if (manual) {
      vscode.window.showErrorMessage('RuleLens failed for a workspace folder. See the RuleLens output channel.');
    }
    paint();
  }

  function refreshFolder(state, manual = false) {
    cancel(state);
    removeFindings(state);
    state.status = 'idle';
    state.scope = undefined;
    const configPath = path.join(state.root, configName);
    if (!vscode.workspace.isTrusted || !existsSync(configPath)) {
      paint();
      return false;
    }

    let config;
    try {
      config = readConfig(state.root);
      state.scope = resolveRelative(state.root, config.scope.relative);
    } catch (failure) {
      fail(state, failure, manual);
      return true;
    }

    const generation = state.generation;
    const settings = vscode.workspace.getConfiguration('ruleLens', state.folder.uri);
    const settingNode = settings.get('nodePath', '').trim();
    const settingTimeout = settings.get('timeoutMs', 0);
    let executable;
    let timeoutMs;
    try {
      ({ executable, timeoutMs } = resolveExecution({
        config: config.execution,
        settingNode,
        settingTimeout,
        env: process.env,
        root: state.root,
      }));
    } catch (failure) {
      fail(state, failure, manual);
      return true;
    }
    state.status = 'running';
    paint();
    const startedAt = Date.now();
    const context = processContext(executable, state.root, timeoutMs);
    output.appendLine(`[${state.root}] Starting scan: ${context}`);
    state.child = execFile(
      executable,
      [cliPath, '--root', state.root],
      {
        cwd: state.root,
        env: process.env,
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (generation !== state.generation || !vscode.workspace.isTrusted) return;
        state.child = undefined;

        try {
          if (error) {
            throw processFailure(
              error,
              stderr,
              context,
              Date.now() - startedAt,
              timeoutMs,
            );
          }
          const report = readReport(state.root, stdout);
          if (report.scope !== state.scope) {
            throw new Error('The configured scope changed during the scan. Refresh to load the current scope.');
          }
          const open = new Map(
            vscode.workspace.textDocuments
              .filter((document) => document.uri.scheme === 'file')
              .map((document) => [document.uri.fsPath, document])
          );
          const entries = [];
          for (const [file, items] of report.files) {
            const uri = vscode.Uri.file(file);
            const document = open.get(file);
            if (stateFor(uri) !== state || document?.isDirty) continue;
            state.files.set(file, items);
            entries.push([
              uri,
              items.map((item) => {
                const severity = item.severity === 'error'
                  ? vscode.DiagnosticSeverity.Error
                  : vscode.DiagnosticSeverity.Warning;
                const diagnostic = new vscode.Diagnostic(findingRange(item, document), item.message, severity);
                diagnostic.source = 'RuleLens';
                diagnostic.code = item.ruleId;
                return diagnostic;
              }),
            ]);
          }
          diagnostics.set(entries);
          state.status = 'ready';
          output.appendLine(`[${state.root}] Scanned ${report.scannedFiles} files in ${Date.now() - startedAt} ms. ${entries.length} files with visible findings.`);
        } catch (failure) {
          fail(state, failure, manual);
          return;
        }

        paint();
      }
    );
    return true;
  }

  function schedule(state) {
    cancel(state);
    removeFindings(state);
    state.status = 'running';
    paint();
    state.timer = setTimeout(() => refreshFolder(state), 200);
  }

  function addFolder(folder) {
    if (folder.uri.scheme !== 'file' || folders.has(folder.uri.fsPath)) return;
    const root = folder.uri.fsPath;
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(folder, configName));
    const state = { root, folder, watcher, files: new Map(), generation: 0, status: 'idle' };
    folders.set(root, state);
    watcher.onDidCreate(() => schedule(state));
    watcher.onDidChange(() => schedule(state));
    watcher.onDidDelete(() => schedule(state));
  }

  function removeFolder(root) {
    const state = folders.get(root);
    if (!state) return;
    cancel(state);
    removeFindings(state);
    state.watcher.dispose();
    folders.delete(root);
  }

  function refresh(manual = false) {
    if (!vscode.workspace.isTrusted) {
      if (manual) vscode.window.showInformationMessage('RuleLens requires a trusted workspace.');
      return;
    }
    for (const folder of vscode.workspace.workspaceFolders || []) addFolder(folder);
    const configured = [...folders.values()].map((state) => refreshFolder(state, manual));
    if (manual && !configured.some(Boolean)) {
      vscode.window.showInformationMessage(`No ${configName} was found in a local workspace folder.`);
    }
  }

  async function showFileFindings() {
    const editor = vscode.window.activeTextEditor;
    const document = editor?.document;
    const state = stateFor(document?.uri);
    const findings = document ? itemsFor(document) : [];
    if (!findings.length) {
      let message = 'No RuleLens findings for the active file.';
      if (!state || state.status === 'idle') {
        message = 'Open a file in a configured, trusted workspace folder to inspect RuleLens findings.';
      } else if (state.scope && !inside(state.scope, document.uri.fsPath)) {
        message = 'The active file is outside the configured RuleLens scope.';
      } else if (state.status === 'running') {
        message = 'RuleLens is refreshing.';
      } else if (state.status === 'failed') {
        message = 'RuleLens failed. See the RuleLens output channel.';
      } else if (state.status === 'cleared') {
        message = 'RuleLens findings were cleared. Run RuleLens: Refresh to restore them.';
      } else if (document.isDirty && state.scope && inside(state.scope, document.uri.fsPath)) {
        message = 'Save the active file to refresh RuleLens findings.';
      }
      vscode.window.showInformationMessage(message);
      return;
    }
    const choices = findings.map((finding) => ({
      label: `$(${finding.severity}) L${finding.line}:${finding.column} [${finding.ruleId}]`,
      description: finding.message,
      detail: finding.guidance,
      finding,
    }));
    const selected = await vscode.window.showQuickPick(choices, {
      title: 'RuleLens · Active file findings',
      placeHolder: 'Filter by rule, message, or guidance. Select a finding to reveal it.',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!selected || !itemsFor(document).includes(selected.finding)) return;
    const active = await vscode.window.showTextDocument(document);
    if (!itemsFor(document).includes(selected.finding)) return;
    const range = findingRange(selected.finding, document);
    active.selection = new vscode.Selection(range.start, range.end);
    active.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    await vscode.commands.executeCommand('editor.action.showHover');
  }

  context.subscriptions.push(
    {
      dispose() {
        for (const root of folders.keys()) removeFolder(root);
      },
    },
    diagnostics,
    output,
    errorDecoration,
    warningDecoration,
    vscode.commands.registerCommand('ruleLens.refresh', () => refresh(true)),
    vscode.commands.registerCommand('ruleLens.clear', () => {
      for (const state of folders.values()) {
        cancel(state);
        removeFindings(state);
        state.status = 'cleared';
      }
      paint();
    }),
    vscode.commands.registerCommand('ruleLens.showFileFindings', showFileFindings),
    vscode.workspace.onDidGrantWorkspaceTrust(() => refresh()),
    vscode.workspace.onDidChangeWorkspaceFolders(({ removed }) => {
      for (const folder of removed) removeFolder(folder.uri.fsPath);
      refresh();
      paint();
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      const state = stateFor(document.uri);
      if (!state) return;
      const file = document.uri.fsPath;
      if (file === path.join(state.root, configName) || (state.scope && inside(state.scope, file))) {
        schedule(state);
      }
    }),
    vscode.workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
      const state = stateFor(document.uri);
      if (!document.isDirty && !contentChanges.length) return;
      if (!state?.files.delete(document.uri.fsPath)) return;
      diagnostics.delete(document.uri);
      paint();
    }),
    vscode.window.onDidChangeVisibleTextEditors(paint)
  );
  refresh();
}

module.exports = { activate };
