const styleSource = /\.(?:css|scss|sass|less|[cm]?[jt]sx?)$/;

module.exports = {
  id: "styles/no-hex-color",
  guidance:
    "Use an approved semantic color token instead of a direct hexadecimal color.",
  check({ file, text }) {
    if (!styleSource.test(file)) return [];
    const findings = [];
    for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
      const match = line.match(/#[0-9a-fA-F]{3,8}\b/);
      if (!match) continue;
      findings.push({
        severity: "warning",
        line: index + 1,
        column: match.index + 1,
        message: `Direct hexadecimal color requires review: ${match[0]}`,
      });
    }
    return findings;
  },
};
