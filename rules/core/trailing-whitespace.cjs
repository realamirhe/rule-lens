function checkLines(text, checkLine) {
  const findings = [];
  for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
    const finding = checkLine(line);
    if (finding) findings.push({ ...finding, line: index + 1 });
  }
  return findings;
}

module.exports = {
  id: "core/trailing-whitespace",
  guidance: "Remove spaces and tabs at the end of the line.",
  check({ text }) {
    return checkLines(text, (line) => {
      const column = line.search(/[ \t]+$/) + 1;
      if (!column) return undefined;
      return { severity: "warning", column, message: "Trailing whitespace." };
    });
  },
};
