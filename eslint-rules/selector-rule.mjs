import { ruleDocsUrl } from "./docs-url.mjs";

/**
 * A rule made of `no-restricted-syntax`-style selectors, each with its own message. Unlike a
 * `no-restricted-syntax` block, it has its own name, so another block for the same files can't
 * replace its options (docs/lint-rules.md, "Why a plugin").
 */
export function selectorRule({ name, description, selectors }) {
  return {
    meta: {
      type: "problem",
      docs: { description, url: ruleDocsUrl(name) },
      schema: [],
      messages: { restricted: "{{message}}" },
    },
    create(context) {
      return Object.fromEntries(
        selectors.map(({ selector, message }) => [
          selector,
          (node) => context.report({ node, messageId: "restricted", data: { message } }),
        ]),
      );
    },
  };
}
