const rules = [
  require("./core/trailing-whitespace.cjs"),
  require("./core/merge-conflict-marker.cjs"),
  require("./source/no-parent-relative-import.cjs"),
  require("./javascript/no-direct-intl.cjs"),
  require("./react/no-manual-use-memo.cjs"),
  require("./styles/no-hex-color.cjs"),
  require("./styles/no-important.cjs"),
  require("./styles/no-literal-pixels.cjs"),
];

module.exports = new Map(rules.map((rule) => [rule.id, rule]));
