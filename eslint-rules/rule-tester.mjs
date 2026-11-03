import { RuleTester } from "eslint";
import { describe, it } from "vitest";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/** ESLint's `RuleTester` wired to vitest, parsing modern JavaScript with JSX (TypeScript syntax isn't needed to test a rule). */
export function createRuleTester() {
  return new RuleTester({
    languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  });
}
