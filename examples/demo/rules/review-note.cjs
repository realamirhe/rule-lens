module.exports = {
  id: 'review-note',
  guidance: 'Read the surrounding code and resolve the question before removing the marker.',
  check({ text }) {
    return text.split(/\r?\n/).flatMap((sourceLine, index) => {
      const column = sourceLine.indexOf('REVIEW_ME');
      if (column === -1) return [];
      return [{
        severity: 'warning',
        line: index + 1,
        column: column + 1,
        message: 'This line contains an unresolved review note.',
      }];
    });
  },
};
