function checkLines(text, checkLine) {
  const findings = [];
  for (const [index, line] of text.split(/\r\n|\r|\n/).entries()) {
    const finding = checkLine(line);
    if (finding) findings.push({ ...finding, line: index + 1 });
  }
  return findings;
}

module.exports = {
  id: "core/merge-conflict-marker",
  guidance: "Resolve the merge conflict and remove the conflict markers.",
  check({ text }) {
    let inConflict = false;
    return checkLines(text, (line) => {
      if (/^<{7,}(?:[ \t]|$)/.test(line)) inConflict = true;
      else if (/^>{7,}(?:[ \t]|$)/.test(line)) inConflict = false;
      else if (
        !inConflict ||
        !/^(?:\|{7,}(?:[ \t]|$)|={7,}[ \t]*$)/.test(line)
      ) {
        return undefined;
      }
      return {
        severity: "error",
        column: 1,
        message: "Unresolved merge conflict marker.",
      };
    });
  },
};
