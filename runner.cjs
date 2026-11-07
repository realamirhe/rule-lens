const { spawnSync } = require("node:child_process");
const {
  errorChain,
  executionConfig,
  minimumNodeLabel,
  supportedNodeVersion,
} = require("./runtime.cjs");

function resolveExecution({ config, settingNode, settingTimeout, env, root, spawn = spawnSync }) {
  const executable =
    settingNode?.trim() || config.nodePath || env.RULE_LENS_NODE || "node";
  const timeoutMs = settingTimeout
    ? executionConfig({ timeoutMs: settingTimeout }).timeoutMs
    : config.timeoutMs;
  const version = spawn(executable, ["--version"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 5_000,
  });
  if (version.error?.code === "ENOENT") {
    throw new Error(
      `Standalone Node executable ${JSON.stringify(executable)} was not found. Set ruleLens.nodePath, execution.nodePath, or RULE_LENS_NODE.`,
      { cause: version.error },
    );
  }
  if (version.error || version.signal || version.status !== 0) {
    throw new Error(
      `Could not execute ${JSON.stringify(executable)} --version (status=${version.status ?? "none"}, signal=${version.signal ?? "none"}). ${version.stderr?.trim() || version.error?.message || ""}`,
      { cause: version.error },
    );
  }
  if (!supportedNodeVersion(version.stdout)) {
    throw new Error(
      `Node ${minimumNodeLabel()} or later is required; ${JSON.stringify(executable)} reported ${version.stdout.trim() || "an invalid version"}.`,
    );
  }
  return { executable, timeoutMs };
}

function processContext(executable, root, timeoutMs) {
  return `executable=${JSON.stringify(executable)} root=${JSON.stringify(root)} timeoutMs=${timeoutMs}`;
}

function processFailure(error, stderr, context, elapsedMs, timeoutMs) {
  const detail = stderr.trim();
  let message;
  if (error?.code === "ETIMEDOUT" || (error?.killed && error?.signal === "SIGTERM")) {
    message = `Scanner timed out after ${elapsedMs} ms (configured limit: ${timeoutMs} ms). Increase execution.timeoutMs in rule-lens.json or ruleLens.timeoutMs in VS Code settings.`;
  } else if (error?.code === "ENOENT") {
    message =
      "Standalone Node executable was not found. Set ruleLens.nodePath, execution.nodePath, or RULE_LENS_NODE.";
  } else if (error?.signal) {
    message = `Scanner terminated by signal ${error.signal}.`;
  } else if (
    /(?:ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|Cannot find (?:package|module))/i.test(detail)
  ) {
    message = `Scanner dependency is missing (exit status ${error?.code ?? "unknown"}). Install the workspace dependencies from its lockfile.`;
  } else if (Number.isInteger(error?.code)) {
    message = `Scanner exited with status ${error.code}.`;
  } else {
    message = `Scanner process failed: ${errorChain(error)}.`;
  }
  return new Error(
    `${message}\nContext: ${context}${detail ? `\nstderr:\n${detail}` : ""}`,
    { cause: error },
  );
}

function parseJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new Error(
      `Invalid scanner JSON from the RuleLens CLI (${Buffer.byteLength(stdout)} bytes).`,
      { cause },
    );
  }
}

function terminate(child, schedule = setTimeout) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  const timer = schedule(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 2_000);
  timer.unref?.();
}

module.exports = {
  parseJson,
  processContext,
  processFailure,
  resolveExecution,
  terminate,
};
