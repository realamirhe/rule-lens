const sourceFile = /\.[cm]?[jt]sx?$/;

module.exports = {
  id: "javascript/no-direct-intl",
  guidance:
    "Use the project's approved localization helper instead of constructing Intl formatters directly.",
  check({ file, text }) {
    if (!sourceFile.test(file)) return [];
    const findings = [];
    for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
      const column = line.search(/\bIntl\s*\./) + 1;
      if (!column) continue;
      findings.push({
        severity: "warning",
        line: index + 1,
        column,
        message: "Direct Intl usage requires review.",
      });
    }
    return findings;
  },
};
