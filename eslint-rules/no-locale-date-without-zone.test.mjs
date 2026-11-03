import rule from "./no-locale-date-without-zone.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const error = { messageId: "localeDate" };

createRuleTester().run("no-locale-date-without-zone", rule, {
  valid: [
    `formatDate(date)`,
    `formatDateTime(iso)`,
    `amount.toLocaleString("en-US", { style: "currency", currency: "EUR" })`,
    `count.toLocaleString("en-US", { maximumFractionDigits: 2 })`,
    `new Intl.NumberFormat("en-US").format(amount)`,
    `const type = Intl.DateTimeFormatPartTypes`,
    `names.toLocaleUpperCase()`,
  ],
  invalid: [
    { code: `new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date)`, errors: [error] },
    { code: `Intl.DateTimeFormat("en-US").format(date)`, errors: [error] },
    { code: `date.toLocaleDateString("en-US")`, errors: [error] },
    { code: `date.toLocaleTimeString()`, errors: [error] },
    { code: `date.toLocaleString()`, errors: [error] },
    { code: `date.toLocaleString("en-GB", { timeZone: "UTC", hour: "2-digit" })`, errors: [error] },
  ],
});
