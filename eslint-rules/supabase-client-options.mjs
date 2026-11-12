import { ruleDocsUrl } from "./docs-url.mjs";

const NAME = "supabase-client-options";

/** The Supabase client constructors, by module: the ones the server builds its clients with. */
const CONSTRUCTORS = {
  "@supabase/supabase-js": "createClient",
  "@supabase/ssr": "createServerClient",
};

/** The local names the constructors have in this file (`import { createClient as createSupabaseClient } …`). */
function constructorNames(program) {
  const names = new Set();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration") continue;
    const wanted = CONSTRUCTORS[statement.source.value];
    if (!wanted) continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportSpecifier" && specifier.imported.name === wanted) names.add(specifier.local.name);
    }
  }
  return names;
}

/** A property's name (`fetch`, `"fetch"`), or null for a spread or a computed key. */
function keyName(property) {
  if (property.type !== "Property" || property.computed) return null;
  if (property.key.type === "Identifier") return property.key.name;
  return property.key.type === "Literal" ? String(property.key.value) : null;
}

/** The value of `name` in an object literal, or undefined when it isn't written there. */
function valueOf(object, name) {
  return object.properties.find((property) => keyName(property) === name)?.value;
}

const rule = {
  meta: {
    type: "problem",
    docs: { description: "A Supabase client gets a traced fetch (spans and the time limit) and no supabase-js retries.", url: ruleDocsUrl(NAME) },
    schema: [],
    messages: {
      inline:
        "Write this Supabase client's options as an object literal here, with `global: { fetch: tracedFetch }` and `db: { retry: false }`, so they can be checked. See docs/lint-rules.md#supabase-client-options.",
      fetch:
        "Give this Supabase client `global: { fetch: tracedFetch }` (src/lib/log/traced-fetch.ts): its calls are then spans in the request line and have a time limit; without it a hung Supabase leaves a page loading for ever. See docs/lint-rules.md#supabase-client-options.",
      retry:
        "Give this Supabase client `db: { retry: false }`: supabase-js retries a failed read up to three times, 1, 2 and 4 s apart, which a page or route can't afford; the browser retries itself. See docs/lint-rules.md#supabase-client-options.",
    },
  },
  create(context) {
    let names = new Set();
    return {
      Program(program) {
        names = constructorNames(program);
      },
      CallExpression(node) {
        if (node.callee.type !== "Identifier" || !names.has(node.callee.name)) return;
        const options = node.arguments[2];
        if (!options || options.type !== "ObjectExpression" || options.properties.some((property) => property.type === "SpreadElement")) {
          context.report({ node: options ?? node, messageId: "inline" });
          return;
        }
        const global = valueOf(options, "global");
        if (global?.type !== "ObjectExpression" || valueOf(global, "fetch") === undefined) context.report({ node: global ?? options, messageId: "fetch" });
        const db = valueOf(options, "db");
        const retry = db?.type === "ObjectExpression" ? valueOf(db, "retry") : undefined;
        if (retry?.type !== "Literal" || retry.value !== false) context.report({ node: retry ?? db ?? options, messageId: "retry" });
      },
    };
  },
};

export default rule;
