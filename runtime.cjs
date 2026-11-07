const MINIMUM_NODE = [18, 3, 0];
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 15 * 60_000;

function parseNodeVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : undefined;
}

function supportedNodeVersion(value) {
  const version = parseNodeVersion(value);
  if (!version) return false;
  for (let index = 0; index < MINIMUM_NODE.length; index += 1) {
    if (version[index] > MINIMUM_NODE[index]) return true;
    if (version[index] < MINIMUM_NODE[index]) return false;
  }
  return true;
}

function minimumNodeLabel() {
  return MINIMUM_NODE.join(".");
}

function validateTimeout(value) {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error(
      `execution.timeoutMs must be an integer from 1000 to ${MAX_TIMEOUT_MS}.`,
    );
  }
  return timeoutMs;
}

function validateNodePath(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) {
    throw new Error("execution.nodePath must be a non-empty executable path or name.");
  }
  return value.trim();
}

function executionConfig(value) {
  if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
    throw new Error("execution must be an object.");
  }
  return {
    timeoutMs: validateTimeout(value?.timeoutMs),
    nodePath: validateNodePath(value?.nodePath),
  };
}

function errorChain(error) {
  const messages = [];
  const seen = new Set();
  for (let current = error; current && !seen.has(current); current = current.cause) {
    seen.add(current);
    const message = current instanceof Error ? current.message : String(current);
    if (message && !messages.includes(message)) messages.push(message);
  }
  return messages.join("\nCaused by: ");
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  errorChain,
  executionConfig,
  minimumNodeLabel,
  supportedNodeVersion,
};
