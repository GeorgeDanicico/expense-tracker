import path from "node:path";

import rule from "./no-fetch-in-components.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const here = (file) => path.resolve(file);
const converted = [{ modules: ["src/components/expenses", "src/app/(app)/expenses/"] }];
const error = { messageId: "request" };

createRuleTester().run("no-fetch-in-components", rule, {
  valid: [
    // No module converted yet: the rule matches nothing.
    { code: `apiRequest("/api/x", {})`, filename: here("src/components/expenses/expense-form.tsx") },
    { code: `fetch("/api/x")`, filename: here("src/components/expenses/expense-form.tsx"), options: [{ modules: [] }] },
    // Another module, which isn't converted.
    { code: `apiRequest("/api/x", {})`, filename: here("src/components/todos/todo-card.tsx"), options: converted },
    // A folder with a similar name is a different module.
    { code: `apiRequest("/api/x", {})`, filename: here("src/components/expenses-old/form.tsx"), options: converted },
    // The module's API object and its tests are where requests live.
    { code: `apiRequest("/api/x", {})`, filename: here("src/components/expenses/expense-api.ts"), options: converted },
    { code: `fetch("/api/x")`, filename: here("src/components/expenses/expense-api.tsx"), options: converted },
    { code: `fetch("/api/x")`, filename: here("src/components/expenses/expense-form.test.tsx"), options: converted },
    // Using the module's hooks is the point.
    { code: `const { add } = useExpenses();`, filename: here("src/components/expenses/expense-form.tsx"), options: converted },
    { code: `api.fetch("/x")`, filename: here("src/components/expenses/expense-form.tsx"), options: converted },
  ],
  invalid: [
    {
      code: `apiRequest("/api/expenses", { method: "POST" })`,
      filename: here("src/components/expenses/expense-form.tsx"),
      options: converted,
      errors: [{ ...error, data: { name: "apiRequest()" } }],
    },
    { code: `fetch("/api/expenses")`, filename: here("src/components/expenses/nested/list.tsx"), options: converted, errors: [error] },
    { code: `window.fetch("/api/expenses")`, filename: here("src/app/(app)/expenses/page.tsx"), options: converted, errors: [error] },
    { code: `globalThis.fetch("/api/expenses")`, filename: here("src/components/expenses/list.tsx"), options: converted, errors: [error] },
  ],
});
