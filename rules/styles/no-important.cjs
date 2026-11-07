module.exports = {
  id: "styles/no-important",
  guidance:
    "Remove !important and resolve the underlying cascade or component contract. Document necessary exceptions in the owning project.",
  check({ file, text }) {
    if (!/\.(?:css|scss|sass|less)$/.test(file)) return [];
    const findings = [];
    for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
      const column = line.indexOf("!important") + 1;
      if (!column) continue;
      findings.push({
        severity: "error",
        line: index + 1,
        column,
        message: "Avoid !important.",
      });
    }
    return findings;
  },
};
