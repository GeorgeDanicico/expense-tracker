import rule from "./no-reduced-motion-query.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "query" };

createRuleTester().run("no-reduced-motion-query", rule, {
  valid: [
    `const reduced = useReducedMotion();`,
    `row.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth" });`,
    `window.matchMedia("(display-mode: standalone)").matches`,
    `window.matchMedia(PHONE_QUERY)`,
    `const text = "prefers-reduced-motion";`,
  ],
  invalid: [
    { code: `window.matchMedia("(prefers-reduced-motion: reduce)").matches`, errors: [error] },
    { code: `const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;`, errors: [error] },
    { code: "matchMedia(`(prefers-reduced-motion: no-preference)`)", errors: [error] },
    { code: `globalThis.matchMedia("(prefers-reduced-motion)")`, errors: [error] },
  ],
});
