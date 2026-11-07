const reactFile = /\.[cm]?[jt]sx$/;

module.exports = {
  id: "react/no-manual-use-memo",
  guidance:
    "Remove useMemo unless the project documents a measured or contractual need for manual memoization.",
  check({ file, text }) {
    if (!reactFile.test(file)) return [];
    const findings = [];
    for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
      const column = line.search(/\buseMemo\s*\(/) + 1;
      if (!column) continue;
      findings.push({
        severity: "warning",
        line: index + 1,
        column,
        message: "Manual useMemo requires review.",
      });
    }
    return findings;
  },
};
