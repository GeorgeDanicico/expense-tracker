const DOC = "https://github.com/GeorgeDanicico/expense-tracker/blob/main/docs/lint-rules.md";

/** Where a rule is explained: its section in docs/lint-rules.md, named after the rule. */
export function ruleDocsUrl(name) {
  return `${DOC}#${name}`;
}
