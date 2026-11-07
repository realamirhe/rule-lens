const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readConfig, scan } = require("../scanner.cjs");

const cli = path.join(__dirname, "..", "cli.cjs");

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rule-lens-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "target", "nested"), { recursive: true });
  return root;
}

function writeConfig(root, scope, rules = ["trailing-whitespace"]) {
  fs.writeFileSync(
    path.join(root, "rule-lens.json"),
    JSON.stringify({ scope, rules }),
  );
}

test("scans only regular UTF-8 files below the configured scope", (t) => {
  const root = workspace(t);
  writeConfig(root, "./target//.", [
    "trailing-whitespace",
    "merge-conflict-marker",
  ]);
  fs.writeFileSync(path.join(root, "outside.txt"), "out  ");
  fs.writeFileSync(path.join(root, "target", "z.txt"), "end\r\n");
  fs.writeFileSync(
    path.join(root, "target", "nested", "a.txt"),
    "\uFEFF😀 \r\n<<<<<<< HEAD\r\n=======\r\n>>>>>>> branch\r\n",
  );
  fs.writeFileSync(path.join(root, "target", "nonutf8"), Buffer.from([0xff, 0x20]));
  fs.writeFileSync(path.join(root, "target", "binary"), "a\0 \n");
  fs.symlinkSync("../outside.txt", path.join(root, "target", "linked-file"));
  fs.symlinkSync("..", path.join(root, "target", "linked-directory"), "dir");
  fs.symlinkSync("missing", path.join(root, "target", "dangling-link"));

  const report = scan(root);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.scope, "target");
  assert.equal(report.scannedFiles, 2);
  assert.deepEqual(
    report.findings.map(({ file, ruleId, severity, line, column }) => [
      file,
      ruleId,
      severity,
      line,
      column,
    ]),
    [
      ["target/nested/a.txt", "trailing-whitespace", "warning", 1, 3],
      ["target/nested/a.txt", "merge-conflict-marker", "error", 2, 1],
      ["target/nested/a.txt", "merge-conflict-marker", "error", 3, 1],
      ["target/nested/a.txt", "merge-conflict-marker", "error", 4, 1],
    ],
  );
  assert.deepEqual(scan(root), report);
});

test("ignores standalone separator lines in Markdown", (t) => {
  const root = workspace(t);
  writeConfig(root, "target", ["merge-conflict-marker"]);
  fs.writeFileSync(
    path.join(root, "target", "example.md"),
    "Heading\n=======\n<<<<<<< HEAD\n||||||| base\n=======\n>>>>>>> branch\n",
  );
  assert.deepEqual(scan(root).findings.map(({ line }) => line), [3, 4, 5, 6]);
});

test("rejects a linked configuration file", (t) => {
  const root = workspace(t);
  writeConfig(root, "target");
  fs.renameSync(
    path.join(root, "rule-lens.json"),
    path.join(root, "original.json"),
  );
  fs.symlinkSync("original.json", path.join(root, "rule-lens.json"));
  assert.throws(() => readConfig(root), /Configuration must be a regular file/);
});

test("rejects root, escape, non-directory, and symbolic link scopes", (t) => {
  const root = workspace(t);
  for (const scope of ["", ".", "./", "..", "../target", "target/../target"]) {
    writeConfig(root, scope);
    assert.throws(() => readConfig(root), /strictly inside the workspace/);
  }

  writeConfig(root, path.join(root, "target"));
  assert.throws(() => readConfig(root), /workspace-relative POSIX path/);

  fs.writeFileSync(path.join(root, "file.txt"), "");
  writeConfig(root, "file.txt");
  assert.throws(() => readConfig(root), /must point to a directory/);

  fs.symlinkSync("target", path.join(root, "link"), "dir");
  for (const scope of ["link", "link/nested"]) {
    writeConfig(root, scope);
    assert.throws(() => readConfig(root), /cannot use a symbolic link/);
  }
});

test("loads a project rule and includes its guidance and findings", (t) => {
  const root = workspace(t);
  writeConfig(root, "target", ["./rule.cjs"]);
  fs.writeFileSync(path.join(root, "target", "a.txt"), "let x = FIXME;\n");
  fs.writeFileSync(
    path.join(root, "rule.cjs"),
    [
      "module.exports = {",
      '  id: "fixme",',
      '  guidance: "Resolve the FIXME before merging.",',
      "  check({ file, text }) {",
      '    const column = text.indexOf("FIXME") + 1;',
      '    return column ? [{ severity: "error", line: 1, column, message: file }] : [];',
      "  },",
      "};",
    ].join("\n"),
  );
  const report = scan(root);
  assert.deepEqual(report.rules, [
    { id: "fixme", guidance: "Resolve the FIXME before merging." },
  ]);
  assert.deepEqual(report.findings, [
    {
      file: "target/a.txt",
      ruleId: "fixme",
      severity: "error",
      line: 1,
      column: 9,
      message: "target/a.txt",
    },
  ]);
});

test("rejects unrecognized rules and invalid or linked plugin files", (t) => {
  const root = workspace(t);
  writeConfig(root, "target", ["unknown"]);
  assert.throws(() => scan(root), /Unknown rule/);

  writeConfig(root, "target", ["./../rule.cjs"]);
  assert.throws(() => scan(root), /strictly inside the workspace/);

  fs.symlinkSync("missing.cjs", path.join(root, "link.cjs"));
  writeConfig(root, "target", ["./link.cjs"]);
  assert.throws(() => scan(root), /cannot use a symbolic link/);

  fs.writeFileSync(path.join(root, "bad.cjs"), "module.exports = {};");
  writeConfig(root, "target", ["./bad.cjs"]);
  assert.throws(() => scan(root), /must export id, guidance, and check/);

  fs.writeFileSync(
    path.join(root, "bad-result.cjs"),
    'module.exports = { id: "bad", guidance: "Test rule", check: () => [{}] };',
  );
  fs.writeFileSync(path.join(root, "target", "a.txt"), "text");
  writeConfig(root, "target", ["./bad-result.cjs"]);
  assert.throws(() => scan(root), /returned an invalid finding/);
});

test("CLI emits JSON on success, uses cwd by default, and reports errors on stderr", (t) => {
  const root = workspace(t);
  writeConfig(root, "target");
  fs.writeFileSync(path.join(root, "target", "a.txt"), "text \n");

  const explicit = spawnSync(process.execPath, [cli, "--root", root], {
    encoding: "utf8",
  });
  assert.equal(explicit.status, 0);
  assert.equal(explicit.stderr, "");
  assert.equal(JSON.parse(explicit.stdout).findings.length, 1);

  const implicit = spawnSync(process.execPath, [cli], { cwd: root, encoding: "utf8" });
  assert.equal(implicit.status, 0);
  assert.equal(implicit.stdout, explicit.stdout);

  fs.writeFileSync(path.join(root, "rule-lens.json"), "{ broken");
  const error = spawnSync(process.execPath, [cli], { cwd: root, encoding: "utf8" });
  assert.equal(error.status, 1);
  assert.equal(error.stdout, "");
  assert.match(error.stderr, /Could not read .*rule-lens\.json/);

  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: rule-lens/);
});
