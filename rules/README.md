# Rule catalog

Each bundled rule has a stable, namespaced ID and lives in its owning category.
Add one CommonJS module per rule and register it in `rules/index.cjs`.

A rule exports `id`, `guidance`, and `check({ file, text })`. Keep bundled rules
project-independent. Do not include product paths, private design decisions, or
framework assumptions that do not apply to all consumers.

Keep project policy in a project-owned `.mjs` rule source. Commit that source to
the same Git repository as its configuration. RuleLens does not download or
execute rules from URLs.
