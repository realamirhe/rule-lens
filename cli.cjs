#!/usr/bin/env node

const { parseArgs } = require("node:util");
const { scanWorkspace } = require("./scanner.cjs");

async function main() {
  try {
    const { values } = parseArgs({
      options: {
        root: { type: "string" },
        "list-rules": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (values.help) {
      process.stdout.write(
        "Usage: rule-lens [--root <dir>] [--list-rules] [--help]\n" +
          "Scan the workspace scope configured in rule-lens.json and emit a JSON report.\n",
      );
    } else {
      const report = await scanWorkspace(values.root ?? process.cwd());
      const output = values["list-rules"] ? report.rules : report;
      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`rule-lens: ${error?.message ?? error}\n`);
    process.exitCode = 1;
  }
}

main();
