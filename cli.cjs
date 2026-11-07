#!/usr/bin/env node

const { parseArgs } = require("node:util");
const { scan } = require("./scanner.cjs");

try {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: rule-lens [--root <dir>] [--help]\n" +
        "Scan the workspace scope configured in rule-lens.json and emit a JSON report.\n",
    );
  } else {
    const report = scan(values.root ?? process.cwd());
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`rule-lens: ${error?.message ?? error}\n`);
  process.exitCode = 1;
}
