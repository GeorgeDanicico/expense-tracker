import rule from "./no-window-confirm.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "blocking" };

createRuleTester().run("no-window-confirm", rule, {
  valid: [
    `confirmDelete()`,
    `api.confirm(id, rows)`,
    `imports.confirm(id)`,
    `toaster.alert("x")`,
    `function confirm(id) { return id; } confirm(1);`,
    `const confirm = () => true; confirm();`,
    `function run(alert) { alert("x"); }`,
    `window.open(url)`,
    `window.location.assign(url)`,
  ],
  invalid: [
    { code: `window.confirm("Delete?")`, errors: [error] },
    { code: `function remove() { if (!window.confirm("Delete?")) return; }`, errors: [error] },
    { code: `window.alert("Saved")`, errors: [error] },
    { code: `window.prompt("Name")`, errors: [error] },
    { code: `globalThis.confirm("Sure?")`, errors: [error] },
    { code: `confirm("Delete?")`, errors: [error] },
    { code: `alert("Saved")`, errors: [error] },
  ],
});
