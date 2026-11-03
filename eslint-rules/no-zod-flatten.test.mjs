import rule from "./no-zod-flatten.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "flatten" };

createRuleTester().run("no-zod-flatten", rule, {
  valid: [
    `fieldErrorsOf(parsed.error)`,
    `z.flattenError(error)`,
    `nested.flat()`,
    `flatten()`,
    `tree.flatten(1)`,
  ],
  invalid: [
    { code: `error.flatten()`, errors: [error] },
    { code: `parsed.error.flatten().fieldErrors`, errors: [error] },
    { code: `schema.safeParse(x).error?.flatten().fieldErrors`, errors: [error] },
  ],
});
