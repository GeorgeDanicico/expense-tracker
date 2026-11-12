import rule from "./supabase-client-options.mjs";
import { createRuleTester } from "./rule-tester.mjs";

const JS = `import { createClient } from "@supabase/supabase-js";`;
const SSR = `import { createServerClient } from "@supabase/ssr";`;

createRuleTester().run("supabase-client-options", rule, {
  valid: [
    `${JS} createClient(url, key, { global: { fetch: tracedFetch }, db: { retry: false }, auth: { persistSession: false } });`,
    `import { createClient as createSupabaseClient } from "@supabase/supabase-js"; createSupabaseClient(url, key, { global: { headers, fetch: tracedFetch }, db: { retry: false } });`,
    // Any fetch expression: the worker's own traced fetch with its longer limit.
    `${JS} createClient(url, key, { global: { fetch: limit === undefined ? tracedFetch : createTracedFetch(undefined, { timeoutMs: limit }) }, db: { retry: false } });`,
    `${SSR} createServerClient(url, key, { global: { fetch: tracedFetch }, db: { retry: false }, cookies: { getAll() {}, setAll() {} } });`,
    // Another library's createClient, or one not imported.
    `import { createClient } from "redis"; createClient({ url });`,
    `createClient(url, key);`,
  ],
  invalid: [
    { code: `${JS} createClient(url, key);`, errors: [{ messageId: "inline" }] },
    { code: `${JS} createClient(url, key, options);`, errors: [{ messageId: "inline" }] },
    { code: `${JS} createClient(url, key, { ...options, db: { retry: false } });`, errors: [{ messageId: "inline" }] },
    { code: `${JS} createClient(url, key, { db: { retry: false } });`, errors: [{ messageId: "fetch" }] },
    { code: `${JS} createClient(url, key, { global: { headers }, db: { retry: false } });`, errors: [{ messageId: "fetch" }] },
    { code: `${JS} createClient(url, key, { global: { fetch: tracedFetch } });`, errors: [{ messageId: "retry" }] },
    { code: `${JS} createClient(url, key, { global: { fetch: tracedFetch }, db: { retry: true } });`, errors: [{ messageId: "retry" }] },
    { code: `${JS} createClient(url, key, { global: { fetch: tracedFetch }, db: { schema: "public" } });`, errors: [{ messageId: "retry" }] },
    { code: `${SSR} createServerClient(url, key, { cookies: {} });`, errors: [{ messageId: "fetch" }, { messageId: "retry" }] },
    { code: `import { createServerClient as make } from "@supabase/ssr"; make(url, key, { global: { fetch: tracedFetch }, cookies: {} });`, errors: [{ messageId: "retry" }] },
  ],
});
