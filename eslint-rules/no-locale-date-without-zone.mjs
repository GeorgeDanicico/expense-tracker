import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "no-locale-date-without-zone";

/** Options that only mean something for a number, so `toLocaleString` with one of them isn't formatting a date. */
const NUMBER_OPTIONS = new Set([
  "style",
  "currency",
  "currencyDisplay",
  "currencySign",
  "unit",
  "unitDisplay",
  "notation",
  "compactDisplay",
  "signDisplay",
  "useGrouping",
  "minimumIntegerDigits",
  "minimumFractionDigits",
  "maximumFractionDigits",
  "minimumSignificantDigits",
  "maximumSignificantDigits",
]);

const isIntlDateTimeFormat = (callee) =>
  callee.type === "MemberExpression" &&
  !callee.computed &&
  callee.object.type === "Identifier" &&
  callee.object.name === "Intl" &&
  callee.property.name === "DateTimeFormat";

function isNumberFormatting(options) {
  return (
    options?.type === "ObjectExpression" &&
    options.properties.some(
      (property) => property.type === "Property" && !property.computed && NUMBER_OPTIONS.has(property.key.name ?? property.key.value),
    )
  );
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Dates are formatted by the formatting module (src/lib/calendar.ts), not with toLocaleDateString, toLocaleString or Intl.DateTimeFormat.",
      url: ruleDocsUrl(NAME),
    },
    schema: [],
    messages: {
      localeDate:
        "Format dates with formatDate / formatDateTime (or add a formatter next to them) in @/lib/calendar, so the locale and the time zone are chosen in one place. " +
        "See docs/lint-rules.md#no-locale-date-without-zone.",
    },
  },
  create(context) {
    return {
      NewExpression(node) {
        if (isIntlDateTimeFormat(node.callee)) context.report({ node, messageId: "localeDate" });
      },
      CallExpression(node) {
        const { callee } = node;
        if (isIntlDateTimeFormat(callee)) {
          context.report({ node, messageId: "localeDate" });
          return;
        }
        if (callee.type !== "MemberExpression" || callee.computed) return;

        const method = callee.property.name;
        if (method === "toLocaleDateString" || method === "toLocaleTimeString") context.report({ node, messageId: "localeDate" });
        // `toLocaleString` is also how numbers get formatted: only a number's own options clear it.
        else if (method === "toLocaleString" && !isNumberFormatting(node.arguments[1])) context.report({ node, messageId: "localeDate" });
      },
    };
  },
};

export default rule;
