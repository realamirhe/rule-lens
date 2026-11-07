const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  parseJson,
  processContext,
  processFailure,
  resolveExecution,
  terminate,
} = require("../runner.cjs");

const config = { timeoutMs: 120_000, nodePath: undefined };

test("resolves standalone Node and configured execution limits", () => {
  const calls = [];
  const resolved = resolveExecution({
    config,
    settingNode: "/node versions/24/bin/node",
    settingTimeout: 150_000,
    env: {},
    root: "/workspace with spaces/project (new)",
    spawn(executable, args, options) {
      calls.push({ executable, args, options });
      return { status: 0, signal: null, stdout: "v24.12.0\n", stderr: "" };
    },
  });
  assert.deepEqual(resolved, {
    executable: "/node versions/24/bin/node",
    timeoutMs: 150_000,
  });
  assert.equal(calls[0].options.cwd, "/workspace with spaces/project (new)");
});

test("reports missing and incompatible standalone Node", () => {
  assert.throws(
    () =>
      resolveExecution({
        config,
        env: {},
        root: "/workspace",
        spawn: () => ({ error: Object.assign(new Error("missing"), { code: "ENOENT" }) }),
      }),
    /ruleLens\.nodePath.*RULE_LENS_NODE/,
  );
  assert.throws(
    () =>
      resolveExecution({
        config,
        env: { RULE_LENS_NODE: "old-node" },
        root: "/workspace",
        spawn: () => ({ status: 0, signal: null, stdout: "v16.20.0", stderr: "" }),
      }),
    /Node 18\.3\.0 or later.*v16\.20\.0/,
  );
});

test("classifies timeout, exit, signal, stderr, and invalid JSON", () => {
  const context = processContext("node", "/workspace (new)", 120_000);
  const timeout = processFailure(
    { killed: true, signal: "SIGTERM" },
    "",
    context,
    120_043,
    120_000,
  );
  assert.match(timeout.message, /timed out after 120043 ms/);
  assert.match(timeout.message, /execution\.timeoutMs/);

  const exit = processFailure({ code: 7 }, "missing dependency: tailwind", context, 10, 120_000);
  assert.match(exit.message, /status 7/);
  assert.match(exit.message, /missing dependency: tailwind/);

  const dependency = processFailure(
    { code: 1 },
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tailwindcss'",
    context,
    10,
    120_000,
  );
  assert.match(dependency.message, /dependency is missing.*exit status 1/);

  const signal = processFailure({ signal: "SIGABRT" }, "", context, 10, 120_000);
  assert.match(signal.message, /signal SIGABRT/);
  assert.throws(() => parseJson("not json"), /Invalid scanner JSON.*8 bytes/);
});

test("terminates a running scan and escalates cleanup", () => {
  const signals = [];
  const child = {
    killed: false,
    exitCode: null,
    signalCode: null,
    kill(signal) {
      signals.push(signal);
      this.killed = true;
    },
  };
  let cleanup;
  terminate(child, (callback) => {
    cleanup = callback;
    return { unref() {} };
  });
  assert.deepEqual(signals, ["SIGTERM"]);
  cleanup();
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});
