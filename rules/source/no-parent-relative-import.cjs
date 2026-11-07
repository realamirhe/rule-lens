const sourceFile = /\.[cm]?[jt]sx?$/;

module.exports = {
  id: "source/no-parent-relative-import",
  guidance:
    "Use the project's approved alias for parent imports. Keep same-directory ./ imports unchanged.",
  check({ file, text }) {
    if (!sourceFile.test(file)) return [];
    const findings = [];
    for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
      const match = line.match(
        /(?:\bfrom\s*|\bimport\s*\(|\brequire\s*\()(["'])(\.\.\/[^"']*)\1/,
      );
      if (!match) continue;
      findings.push({
        severity: "error",
        line: index + 1,
        column: match.index + match[0].indexOf(match[2]) + 1,
        message: `Parent-relative import: ${match[2]}`,
      });
    }
    return findings;
  },
};
