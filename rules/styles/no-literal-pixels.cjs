const styleSource = /\.(?:css|scss|sass|less|[cm]?[jt]sx?)$/;

module.exports = {
  id: "styles/no-literal-pixels",
  guidance:
    "Use an approved design token. Keep a literal pixel value only with a documented project exception.",
  check({ file, text }) {
    if (!styleSource.test(file)) return [];
    const findings = [];
    for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
      const match = line.match(/\b\d+(?:\.\d+)?px\b/);
      if (!match) continue;
      findings.push({
        severity: "warning",
        line: index + 1,
        column: match.index + 1,
        message: `Literal pixel value requires review: ${match[0]}`,
      });
    }
    return findings;
  },
};
