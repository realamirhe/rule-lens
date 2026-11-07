# RuleLens

RuleLens shows findings in VS Code and exports the same findings as JSON for an agent. Each workspace selects one subfolder to scan and supplies its own rules.

## Install from source

Use VS Code 1.85 or later, its `code` CLI, and Python 3. Run this command from the RuleLens checkout:

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
  "rules": ["trailing-whitespace", "merge-conflict-marker", "./rules/project-rule.cjs"]
}
```

Set `scope` to an existing subfolder. The scanner visits its nested directories and reads regular UTF-8 text files. It skips binary files and symbolic links. An empty scope, the workspace root, and paths that leave the workspace are invalid. A workspace without a config has no active review.

The two built-in rules are opt-in. Remove the example plugin entry if you do not have a local rule file. Rule modules are executable Node code. Review them before enabling a workspace or running the CLI. Rules can access files with the user's permissions. The scope limits the scanner's own file traversal.

Open the workspace in trusted mode. Findings appear in **Problems** and beside the affected lines. Run **RuleLens: Show File Findings** to inspect and jump to a finding in the active file. Saving a file in scope triggers a refresh. Use **RuleLens: Refresh** to rescan after external edits or **RuleLens: Clear** to remove markers.

## Give findings to an agent

Use Node.js 18.3 or later. Run the CLI from any directory and give it the workspace path:

```sh
node /path/to/rule-lens/cli.cjs --root /path/to/workspace > /tmp/rule-lens.json
```

Save source edits before running the CLI. A successful scan exits with code zero, including scans with findings. Configuration and execution errors exit nonzero and write a message to stderr.

Give the agent the JSON report and access to the same workspace. `findings` contains the workspace-relative file, rule ID, severity, message, and 1-based UTF-16 line and column. Match each `ruleId` to `rules[].id` for remediation guidance. Ask the agent to read the cited source and use the guidance to propose a fix. Review output provides evidence. Your task request defines which changes the agent can make.

## Add a project rule

A local `.cjs` module exports an `id`, a `guidance` string, and `check({ file, text })`. The check returns an array of findings with `severity` (`error` or `warning`), `line`, `column`, and `message`. The scanner supplies the workspace-relative `file` with forward slashes and adds the rule ID to each result. Send rule logs to stderr so stdout remains valid JSON.

Keep product paths, policy, and framework assumptions in the consuming workspace's rule modules. Use `examples/demo/rules/review-note.cjs` as a template. Keep shared rules opt-in and add fixtures for any policy you migrate.

## Verify the example

```sh
npm test
node cli.cjs --root examples/demo
```

Open `examples/demo` as a workspace and refresh RuleLens to compare the markers with the JSON. The nested example file has findings. The file beside the config is outside the scan scope.
