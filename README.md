# RuleLens

RuleLens shows findings in VS Code and exports the same findings as JSON for an agent. Each workspace selects one subfolder to scan and supplies its own rules.

## Install from source

Use VS Code 1.85 or later, standalone Node 18.3 or later, the `code` CLI,
and Python 3. Run this command from the RuleLens checkout:

```sh
python3 scripts/vsix.py install
```

The script builds a temporary VSIX, installs it locally with settings sync disabled, then deletes the file. It uses the checked-out source and the Python standard library. Run it again after updating the checkout and reload VS Code.

To install in a named profile, add `--profile "Frontend"`. To select a VS Code executable, add `--code /path/to/code`. To make a file for manual installation, run `python3 scripts/vsix.py package /tmp/rule-lens.vsix` and use **Extensions: Install from VSIX**. Generated VSIX files are ignored by Git.

## Configure a workspace

Create `rule-lens.json` in the VS Code workspace folder:

```json
{
  "scope": "src/features/search",
  "rules": [
    "core/trailing-whitespace",
    "core/merge-conflict-marker",
    "./rules/project-rule.cjs"
  ]
}
```

For a project-owned whole-scope scanner, use an executable ESM module instead:

```json
{
  "scope": "src/features/search",
  "scanner": "./scripts/rule-lens-search.mjs",
  "execution": {
    "timeoutMs": 120000
  }
}
```

The `.mjs` module must default-export an async or synchronous function receiving
`{ root, scope, execution }`. It returns `scannedFiles`, `rules`, and `findings`.
RuleLens adds the portable report schema and configured scope after validating
the result. The default deadline is 120 seconds. Valid values are 1–900 seconds.
Use `scanner` by itself. Use `rules` with optional `ruleSources` for named packs.

A minimal scanner looks like this:

```js
export default async function scan({ root, scope, execution }) {
  // Load project dependencies from root and inspect only scope.
  return {
    scannedFiles: 0,
    rules: [{ id: 'project/example', guidance: 'Resolve the example.' }],
    findings: [],
  };
}
```

Do not return an empty successful report after a dependency or execution
failure. Throw an error and retain the original error as `cause` when wrapping
it. RuleLens reports the failure instead of clearing it as a clean scan.

For a project-owned named rule pack, keep the source in the project's Git
repository and select its rules by stable ID:

```json
{
  "scope": "src/features/search",
  "ruleSources": ["./scripts/search-review.mjs"],
  "rules": ["search-review/accessibility/*", "search-review/import-boundary"]
}
```

Each rule source default-exports the same scanner function. It returns its full
rule catalog and findings. RuleLens filters the report with the configured exact
IDs and trailing `*` prefixes. Sources receive the selected IDs as `rules` so
they can skip unnecessary work. Rule IDs must be unique across all sources.

Set `scope` to an existing subfolder. The scanner visits its nested directories and reads regular UTF-8 text files. It skips binary files and symbolic links. An empty scope, the workspace root, and paths that leave the workspace are invalid. A workspace without a config has no active review.

Bundled rules are opt-in and live in `rules/`. See `rules/README.md` before
adding one. Project rule modules and sources are executable Node code. Review
them before enabling a workspace or running the CLI. They can access files with
the user's permissions. The scope limits only RuleLens's built-in traversal.

Open the workspace in trusted mode. Findings appear in **Problems** and beside the affected lines. Run **RuleLens: Show File Findings** to inspect and jump to a finding in the active file. Saving a file in scope triggers a refresh. Use **RuleLens: Refresh** to rescan after external edits or **RuleLens: Clear** to remove markers.

## Standalone Node and native dependencies

The extension starts its CLI with standalone Node. It does not load custom
scanners in VS Code's Electron runtime. This supports project scanners whose
Tailwind or other native dependencies are incompatible with signed Electron.

RuleLens selects Node in this order:

1. VS Code setting `ruleLens.nodePath`.
2. `execution.nodePath` in `rule-lens.json`.
3. Environment variable `RULE_LENS_NODE`.
4. `node` from the VS Code process `PATH`.

Use the VS Code setting or environment variable for a machine-specific path.
Do not commit a Homebrew- or user-specific absolute path. RuleLens runs
`<node> --version` before every scan and requires Node 18.3 or later.

The VS Code setting `ruleLens.timeoutMs` overrides `execution.timeoutMs` when it
is nonzero. The extension applies one outer deadline to the complete CLI scan.
Project scanners receive the same execution settings and must not impose a
shorter hidden deadline. A scanner that starts workers must terminate them on
`SIGTERM`; RuleLens terminates its CLI when a scan is refreshed, cleared, or
the extension is disposed.

## Give findings to an agent

Use Node.js 18.3 or later. Run the CLI from any directory and give it the workspace path:

```sh
node /path/to/rule-lens/cli.cjs --root /path/to/workspace > /tmp/rule-lens.json
```

Save source edits before running the CLI. A successful scan exits with code zero, including scans with findings. Configuration and execution errors exit nonzero and write a message to stderr.

Run the same command before opening VS Code. Valid JSON proves that the project
dependencies, scanner module, rules, and standalone Node runtime can complete a
scan. Findings are review results; they are not all confirmed product bugs.

Give the agent the JSON report and access to the same workspace. `findings` contains the workspace-relative file, rule ID, severity, message, and 1-based UTF-16 line and column. Match each `ruleId` to `rules[].id` for remediation guidance. Ask the agent to read the cited source and use the guidance to propose a fix. Review output provides evidence. Your task request defines which changes the agent can make.

List the configured named rules without retaining the findings output:

```sh
node /path/to/rule-lens/cli.cjs --root /path/to/workspace --list-rules
```

## Bundled rule names

- `core/trailing-whitespace`
- `core/merge-conflict-marker`
- `source/no-parent-relative-import`
- `javascript/no-direct-intl`
- `react/no-manual-use-memo`
- `styles/no-important`
- `styles/no-literal-pixels`
- `styles/no-hex-color`

## Add a project rule

A local `.cjs` rule module exports an `id`, a `guidance` string, and `check({ file, text })`. The check returns an array of findings with `severity` (`error` or `warning`), `line`, `column`, and `message`. The scanner supplies the workspace-relative `file` with forward slashes and adds the rule ID to each result. Send rule logs to stderr so stdout remains valid JSON.

Keep product paths, policy, and framework assumptions in the consuming workspace's rule modules. Use `examples/demo/rules/review-note.cjs` as a template. Keep shared rules opt-in and add fixtures for any policy you migrate.

## Verify the example

```sh
npm test
node cli.cjs --root examples/demo
```

Open `examples/demo` as a workspace and refresh RuleLens to compare the markers with the JSON. The nested example file has findings. The file beside the config is outside the scan scope.

## Troubleshooting

- **Timeout:** The output includes elapsed and configured milliseconds. Increase
  `execution.timeoutMs` or the user-level `ruleLens.timeoutMs`. Measure cold and
  slower-machine runs; a warm run is not a safe upper bound.
- **Node not found or unsupported:** Run the configured executable with
  `--version`. Set `ruleLens.nodePath` or `RULE_LENS_NODE` to standalone Node
  18.3 or later. Do not point it at the VS Code Electron executable.
- **Nonzero exit:** Read the exit status, stderr, executable, workspace root,
  and timeout in **Output → RuleLens**. Install the workspace dependencies with
  the project's documented package-manager command.
- **Signal:** The process was terminated by the reported signal. A refresh or
  clear intentionally cancels the older scan; unexpected signals need scanner
  or operating-system investigation.
- **Invalid scanner JSON:** Run the CLI directly. Keep stdout for the one JSON
  report and send logs to stderr.
- **Missing scanner dependency:** Install the matching lockfile dependencies.
  Resolve imports from the workspace root; do not rely on global packages.
