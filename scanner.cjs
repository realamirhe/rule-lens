const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");
const { pathToFileURL } = require("node:url");

const decoder = new TextDecoder("utf-8", { fatal: true });
const binaryControls = /[\x00-\x08\x0b\x0e-\x1f]/;

function checkLines(text, checkLine) {
  const findings = [];
  for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
    const finding = checkLine(line);
    if (finding) {
      findings.push({ ...finding, line: index + 1 });
    }
  }
  return findings;
}

const builtins = new Map([
  [
    "trailing-whitespace",
    {
      id: "trailing-whitespace",
      guidance: "Remove spaces and tabs at the end of the line.",
      check({ text }) {
        return checkLines(text, (line) => {
          const column = line.search(/[ \t]+$/) + 1;
          if (column) {
            return {
              severity: "warning",
              column,
              message: "Trailing whitespace.",
            };
          }
        });
      },
    },
  ],
  [
    "merge-conflict-marker",
    {
      id: "merge-conflict-marker",
      guidance: "Resolve the merge conflict and remove the conflict markers.",
      check({ text }) {
        let inConflict = false;
        return checkLines(text, (line) => {
          if (/^<{7,}(?:[ \t]|$)/.test(line)) {
            inConflict = true;
          } else if (/^>{7,}(?:[ \t]|$)/.test(line)) {
            inConflict = false;
          } else if (
            !inConflict ||
            !/^(?:\|{7,}(?:[ \t]|$)|={7,}[ \t]*$)/.test(line)
          ) {
            return;
          }
          return {
            severity: "error",
            column: 1,
            message: "Unresolved merge conflict marker.",
          };
        });
      },
    },
  ],
]);

function workspacePath(root, relative, label, finalType) {
  if (
    typeof relative !== "string" ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    relative.includes("\\") ||
    relative.includes("\0")
  ) {
    throw new Error(`${label} must be a workspace-relative POSIX path.`);
  }

  const parts = relative.split("/").filter((part) => part !== "." && part !== "");
  if (parts.length === 0 || parts.includes("..")) {
    throw new Error(`${label} must point to a path strictly inside the workspace.`);
  }

  let absolute = root;
  for (const [index, part] of parts.entries()) {
    absolute = path.join(absolute, part);
    const stat = fs.lstatSync(absolute);
    const expected = index === parts.length - 1 ? finalType : "directory";
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} cannot use a symbolic link: ${absolute}`);
    }
    if (expected === "directory" ? !stat.isDirectory() : !stat.isFile()) {
      throw new Error(`${label} must point to a ${expected}: ${absolute}`);
    }
  }
  return { absolute, relative: parts.join("/") };
}

function loadRules(root, entries) {
  const ids = new Set();
  return entries.map((entry) => {
    let rule = builtins.get(entry);
    if (!rule) {
      if (
        typeof entry !== "string" ||
        !entry.startsWith("./") ||
        !entry.endsWith(".cjs")
      ) {
        throw new Error(`Unknown rule: ${JSON.stringify(entry)}`);
      }
      const { absolute } = workspacePath(root, entry, "Plugin", "file");
      rule = require(absolute);
    }
    if (
      !rule ||
      typeof rule.id !== "string" ||
      !rule.id.trim() ||
      typeof rule.guidance !== "string" ||
      typeof rule.check !== "function"
    ) {
      throw new Error(`Rule ${entry} must export id, guidance, and check.`);
    }
    if (ids.has(rule.id)) {
      throw new Error(`Duplicate rule ID: ${rule.id}`);
    }
    ids.add(rule.id);
    return rule;
  });
}

function* walk(directory, prefix) {
  for (const name of fs.readdirSync(directory).sort()) {
    const absolute = path.join(directory, name);
    const relative = `${prefix}/${name}`;
    const stat = fs.lstatSync(absolute);
    if (stat.isDirectory()) {
      yield* walk(absolute, relative);
    } else if (stat.isFile()) {
      yield { absolute, relative };
    }
  }
}

function readText(file) {
  const bytes = fs.readFileSync(file);
  let text;
  try {
    text = decoder.decode(bytes);
  } catch {
    return null;
  }
  return binaryControls.test(text) ? null : text;
}

function checkRule(rule, file, text) {
  const findings = rule.check({ file, text });
  if (!Array.isArray(findings)) {
    throw new Error(`Rule ${rule.id} must return an array of findings for ${file}.`);
  }
  return findings.map((finding) => {
    const { severity, line, column, message } = finding ?? {};
    if (
      (severity !== "error" && severity !== "warning") ||
      !Number.isSafeInteger(line) ||
      line < 1 ||
      !Number.isSafeInteger(column) ||
      column < 1 ||
      typeof message !== "string"
    ) {
      throw new Error(`Rule ${rule.id} returned an invalid finding for ${file}.`);
    }
    return { file, ruleId: rule.id, severity, line, column, message };
  });
}

function readConfig(workspaceRoot) {
  const root = fs.realpathSync(workspaceRoot);
  const configPath = path.join(root, "rule-lens.json");
  let config;
  try {
    if (!fs.lstatSync(configPath).isFile()) {
      throw new Error("Configuration must be a regular file.");
    }
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${configPath}: ${error.message}`);
  }
  const scope = workspacePath(root, config?.scope, "Scope", "directory");
  const hasRules = Array.isArray(config.rules);
  const hasScanner = config.scanner !== undefined;
  if (hasRules === hasScanner) {
    throw new Error("Configuration must define exactly one of rules or scanner.");
  }
  if (hasScanner) {
    const scanner = workspacePath(root, config.scanner, "Scanner", "file");
    if (!scanner.relative.endsWith(".mjs")) {
      throw new Error("Scanner must point to an .mjs module.");
    }
    return { root, scope, scanner };
  }
  return { root, scope, ruleEntries: config.rules };
}

function scan(workspaceRoot) {
  const { root, scope, ruleEntries } = readConfig(workspaceRoot);
  if (!ruleEntries) {
    throw new Error("This configuration uses a scanner module; use scanWorkspace().");
  }
  const rules = loadRules(root, ruleEntries);
  let scannedFiles = 0;
  const findings = [];

  for (const { absolute, relative } of walk(scope.absolute, scope.relative)) {
    const text = readText(absolute);
    if (text === null) {
      continue;
    }
    scannedFiles++;
    const fileFindings = rules.flatMap((rule) => checkRule(rule, relative, text));
    fileFindings.sort(
      (left, right) => left.line - right.line || left.column - right.column,
    );
    for (const finding of fileFindings) {
      findings.push(finding);
    }
  }

  return {
    schemaVersion: 1,
    scope: scope.relative,
    scannedFiles,
    rules: rules.map(({ id, guidance }) => ({ id, guidance })),
    findings,
  };
}

function validateScannerReport(report, scope) {
  if (
    !report ||
    !Number.isSafeInteger(report.scannedFiles) ||
    report.scannedFiles < 0 ||
    !Array.isArray(report.rules) ||
    !Array.isArray(report.findings)
  ) {
    throw new Error("Scanner returned an invalid report.");
  }
  const ids = new Set();
  for (const rule of report.rules) {
    if (
      typeof rule?.id !== "string" ||
      !rule.id ||
      typeof rule.guidance !== "string" ||
      ids.has(rule.id)
    ) {
      throw new Error("Scanner returned an invalid or duplicate rule.");
    }
    ids.add(rule.id);
  }
  for (const finding of report.findings) {
    if (
      typeof finding?.file !== "string" ||
      !(finding.file === scope || finding.file.startsWith(`${scope}/`)) ||
      !ids.has(finding.ruleId) ||
      !["error", "warning"].includes(finding.severity) ||
      !Number.isSafeInteger(finding.line) ||
      finding.line < 1 ||
      !Number.isSafeInteger(finding.column) ||
      finding.column < 1 ||
      typeof finding.message !== "string"
    ) {
      throw new Error("Scanner returned an invalid finding.");
    }
  }
  return {
    ...report,
    schemaVersion: 1,
    scope,
  };
}

async function scanWorkspace(workspaceRoot) {
  const config = readConfig(workspaceRoot);
  if (!config.scanner) return scan(config.root);
  const loaded = await import(pathToFileURL(config.scanner.absolute).href);
  if (typeof loaded.default !== "function") {
    throw new Error("Scanner module must export a default function.");
  }
  const report = await loaded.default({
    root: config.root,
    scope: config.scope.relative,
  });
  return validateScannerReport(report, config.scope.relative);
}

module.exports = { readConfig, scan, scanWorkspace };
