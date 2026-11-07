const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('editor gates scans by trust and config, and drops stale diagnostics', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-lens-editor-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const configured = path.join(base, 'configured');
  const unconfigured = path.join(base, 'unconfigured');
  fs.mkdirSync(path.join(configured, 'src'), { recursive: true });
  fs.mkdirSync(unconfigured);
  fs.writeFileSync(
    path.join(configured, 'rule-lens.json'),
    JSON.stringify({ scope: 'src', rules: ['trailing-whitespace'] })
  );

  const uri = (fsPath) => ({ fsPath, scheme: 'file' });
  const file = path.join(configured, 'src', 'file.txt');
  const document = { uri: uri(file), isDirty: false };
  const diagnostics = new Map();
  const commands = new Map();
  const handlers = {};
  const children = [];
  const disposable = { dispose() {} };
  const listen = (name) => (handler) => {
    handlers[name] = handler;
    return disposable;
  };
  const folders = [configured, unconfigured].map((root) => ({ uri: uri(root) }));

  let choices;
  const vscode = {
    commands: {
      registerCommand(name, callback) {
        commands.set(name, callback);
        return disposable;
      },
    },
    languages: {
      createDiagnosticCollection: () => ({
        ...disposable,
        set(entries) {
          for (const [item, values] of entries) diagnostics.set(item.fsPath, values);
        },
        delete(item) {
          diagnostics.delete(item.fsPath);
        },
      }),
    },
    workspace: {
      isTrusted: false,
      workspaceFolders: folders,
      textDocuments: [],
      getWorkspaceFolder: () => folders[0],
      createFileSystemWatcher: () => ({
        ...disposable,
        onDidCreate() {},
        onDidChange() {},
        onDidDelete() {},
      }),
      onDidGrantWorkspaceTrust: listen('trust'),
      onDidChangeWorkspaceFolders: listen('folders'),
      onDidChangeTextDocument: listen('edit'),
      onDidSaveTextDocument: listen('save'),
    },
    window: {
      activeTextEditor: { document },
      visibleTextEditors: [],
      createOutputChannel: () => ({ ...disposable, appendLine() {} }),
      createTextEditorDecorationType: () => disposable,
      onDidChangeVisibleTextEditors: listen('visible'),
      showQuickPick(items) {
        choices = items;
      },
    },
    Uri: { file: uri },
    RelativePattern: class {},
    ThemeColor: class {},
    OverviewRulerLane: { Right: 1 },
    DecorationRangeBehavior: { ClosedClosed: 1 },
    Range: class {
      constructor(...coordinates) {
        this.coordinates = coordinates;
      }
    },
    Diagnostic: class {
      constructor(range, message, severity) {
        Object.assign(this, { range, message, severity });
      }
    },
    DiagnosticSeverity: { Error: 0, Warning: 1 },
  };
  const load = Module._load;
  let activate;
  try {
    Module._load = function (name, ...args) {
      if (name === 'vscode') return vscode;
      if (name === 'node:child_process') {
        return {
          execFile(executable, args, options, complete) {
            const child = { executable, args, options, complete, killed: false, kill() { this.killed = true; } };
            children.push(child);
            return child;
          },
        };
      }
      return load.call(this, name, ...args);
    };
    ({ activate } = require('../extension.cjs'));
  } finally {
    Module._load = load;
  }

  const report = JSON.stringify({
    schemaVersion: 1,
    scope: 'src',
    scannedFiles: 1,
    rules: [{ id: 'trailing-whitespace', guidance: 'Remove trailing spaces.' }],
    findings: [{
      file: 'src/file.txt',
      ruleId: 'trailing-whitespace',
      severity: 'warning',
      line: 2,
      column: 3,
      message: 'Trailing whitespace.',
    }],
  });
  const context = { subscriptions: [] };
  activate(context);
  t.after(() => {
    for (const subscription of context.subscriptions) subscription.dispose();
  });
  assert.equal(children.length, 0);

  vscode.workspace.isTrusted = true;
  handlers.trust();
  assert.equal(children.length, 1);
  assert.deepEqual(children[0].args.slice(-2), ['--root', configured]);
  assert.equal(children[0].executable, process.execPath);
  assert.equal(children[0].options.env.ELECTRON_RUN_AS_NODE, '1');
  children[0].complete(null, report, '');
  assert.deepEqual(diagnostics.get(file)[0].range.coordinates, [1, 2, 1, 3]);
  await commands.get('ruleLens.showFileFindings')();
  assert.equal(choices[0].detail, 'Remove trailing spaces.');

  document.isDirty = true;
  handlers.edit({ document, contentChanges: [{}] });
  assert.equal(diagnostics.size, 0);

  commands.get('ruleLens.refresh')();
  vscode.workspace.textDocuments = [document];
  children[1].complete(null, report, '');
  assert.equal(diagnostics.size, 0);

  document.isDirty = false;
  commands.get('ruleLens.refresh')();
  handlers.save(document);
  assert.equal(children[2].killed, true);
  children[2].complete(null, report, '');
  assert.equal(diagnostics.size, 0);

  commands.get('ruleLens.refresh')();
  commands.get('ruleLens.clear')();
  assert.equal(children[3].killed, true);
  children[3].complete(null, report, '');
  assert.equal(diagnostics.size, 0);
});
