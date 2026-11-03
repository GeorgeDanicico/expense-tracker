import rule from "./no-iso-date-slice.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "isoSlice" };

createRuleTester().run("no-iso-date-slice", rule, {
  valid: [
    `getBucharestToday()`,
    `date.toISOString()`,
    `date.toISOString().slice(0, 16)`,
    `date.toISOString().slice(11)`,
    `date.toISOString().padStart(10)`,
    `text.slice(0, 10)`,
    `isoString.split("T")[0]`,
    `date.toISOString().split("-")[0]`,
    `date.toISOString().split("T")`,
    `date.toISOString().split("T")[1]`,
  ],
  invalid: [
    { code: `new Date().toISOString().slice(0, 10)`, errors: [error] },
    { code: `const day = endDate.toISOString().slice(0, 10);`, errors: [error] },
    { code: `value.toISOString().substring(0, 10)`, errors: [error] },
    { code: `new Date(x).toISOString().split("T")[0]`, errors: [error] },
    { code: `const [day] = new Date().toISOString().split("T");`, errors: [error] },
  ],
});
