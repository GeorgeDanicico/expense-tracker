import { selectorRule } from "./selector-rule.mjs";

const FILTER_CALL = "CallExpression[callee.type='MemberExpression']";
const FILTER_MESSAGE =
  "Don't build a PostgREST filter from a string: it can inject operators and clauses. Pass values as arguments (.eq, .in, .gte), " +
  "or check each part against a catalogue first (see src/lib/supabase/filters.ts). A reviewed constant may use " +
  "// eslint-disable-next-line local/postgrest-filter-string -- <reason>.";

/**
 * Injection guard (security plan S8): the string given to `.or()` and `.filter()` is parsed by
 * PostgREST, so `,` `(` `)` and `.` in it change the query. A template literal or `+` there is
 * refused, and so is any `.or()` argument that isn't a plain string literal (for example a joined
 * array). Where the string is built from a catalogue or is a constant, add a reviewed disable comment.
 */
export default selectorRule({
  name: "postgrest-filter-string",
  description: "A PostgREST filter string (.or, .filter) isn't built from a template, a `+`, or anything but a literal.",
  selectors: [
    `${FILTER_CALL}[callee.property.name=/^(or|filter)$/] > TemplateLiteral.arguments:first-child`,
    `${FILTER_CALL}[callee.property.name=/^(or|filter)$/] > BinaryExpression[operator='+'].arguments:first-child`,
    `${FILTER_CALL}[callee.property.name='or'] > :not(:matches(Literal, TemplateLiteral, BinaryExpression[operator='+'])).arguments:first-child`,
  ].map((selector) => ({ selector, message: FILTER_MESSAGE })),
});
