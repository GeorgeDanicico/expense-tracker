import rule from "./no-local-date-parse.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "local" };

createRuleTester().run("no-local-date-parse", rule, {
  valid: [
    "new Date(`${date}T12:00:00Z`)",
    "new Date(`${date}T00:00:00.000Z`)",
    "new Date(`${month}-01T12:00:00+02:00`)",
    'new Date("2026-10-01")',
    "new Date(`${date}`)",
    "new Date(iso)",
    "new Date()",
    "new Date(2026, 9, 1)",
    'Date.parse("2026-10-01T09:00:00Z")',
    "new Temporal(`${date}T12:00`)",
  ],
  invalid: [
    { code: "new Date(`${date}T12:00:00`)", errors: [error] },
    { code: "new Date(`${month}-01T12:00:00`)", errors: [error] },
    { code: "new Date(`${date}T${time}:00`)", errors: [error] },
    { code: 'new Date("2026-10-01T09:30")', errors: [error] },
    { code: "new Date(`${date}T00:00:00.000`)", errors: [error] },
    { code: "Date.parse(`${date}T09:00`)", errors: [error] },
  ],
});
