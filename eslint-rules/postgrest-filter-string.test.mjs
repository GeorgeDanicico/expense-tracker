import rule from "./postgrest-filter-string.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const message = (code) => ({ code, errors: [{ messageId: "restricted" }] });

createRuleTester().run("postgrest-filter-string", rule, {
  valid: [
    `query.or("a.eq.1,b.eq.2")`,
    `query.filter("a", "eq", value)`,
    `query.eq("a", value)`,
    `query.in("a", values)`,
    `query.filter(column, "eq", value)`,
    `items.and(first)`,
    `or(parts.join(","))`,
  ],
  invalid: [
    message("query.or(`name.eq.${name}`)"),
    message("query.filter(`a.${b}`, 'eq', c)"),
    message(`query.or("a.eq." + value)`),
    message(`query.filter("a." + column, "eq", value)`),
    message(`query.or(parts.join(","))`),
    message(`query.or(filter)`),
    message("query.or(`constant`)"),
    message(`items.or(first, second)`),
  ],
});
