import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "no-local-date-parse";
/** A date and time with no `Z` or offset at the end: JavaScript reads it in the device's zone. */
const LOCAL_TIME = /T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * The text of a string or template literal, each `${…}` read as "00" (a date part or a time part), or
 * null for anything else.
 */
function literalText(node) {
  if (node?.type === "Literal" && typeof node.value === "string") return node.value;
  if (node?.type === "TemplateLiteral") return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("00");
  return null;
}

const isDate = (node) => node.type === "Identifier" && node.name === "Date";
const isDateParse = (node) =>
  node.type === "MemberExpression" && !node.computed && isDate(node.object) && node.property.name === "parse";

const rule = {
  meta: {
    type: "problem",
    docs: { description: "new Date(`${date}T12:00:00`) with no zone: the device's zone decides the instant.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      local:
        "This date and time has no zone, so it is read in the device's zone and can be another day elsewhere. " +
        "End it with Z (and format in UTC), or use the helpers in src/lib/calendar.ts. See docs/lint-rules.md#no-local-date-parse.",
    },
  },
  create(context) {
    const check = (node, argument) => {
      const text = literalText(argument);
      if (text !== null && LOCAL_TIME.test(text)) context.report({ node, messageId: "local" });
    };
    return {
      NewExpression(node) {
        if (isDate(node.callee) && node.arguments.length === 1) check(node, node.arguments[0]);
      },
      CallExpression(node) {
        if (isDateParse(node.callee)) check(node, node.arguments[0]);
      },
    };
  },
};

export default rule;
