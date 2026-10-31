---
name: feature-map
description: Build and export a map of every feature in this app (expenses, expense tabs, investments, net worth, families and permissions, avatars, MCP access, to-dos, reminders, notifications, calendar, statement import, AI gate, settings, auth…) linking each to its pages, API routes, lib modules, components, tables, SQL functions, RLS policies, MCP tools, worker jobs, flags, env vars and tests. Use when asked for a "feature map", to "map the app's features", "what features does the app have", "which files/tables/tests belong to feature X", "how do the features depend on each other", or to "export the feature map" / regenerate docs/feature-map.
---

# Feature map

Generates `docs/feature-map/` from the code, so it can be rebuilt any time instead of written by hand:

- `feature-map.md`: one section per feature in plain English (pages, API routes, library modules, components and hooks, database, MCP tools, worker jobs, flags and env vars, tests, links), an overview table, a Mermaid dependency diagram, the navigation, and the **Unassigned** list.
- `feature-map.html`: one self-contained page (no network requests) with a feature list, search across every item with type filters, an SVG dependency diagram (hover to highlight, click to open), and the Unassigned list. Light and dark mode.
- `feature-map.json`: the full grouped data, for scripts and agents.

Only `feature-map.md` is committed. The `.html` and `.json` files are large (about 0.5 MB and 0.9 MB), so they are git-ignored: run the script to get them.

## Run it

```bash
npm run feature-map                  # ~20 s: runs `vitest list` for exact test counts
npm run feature-map -- --static-tests  # ~2 s: counts it()/test() calls instead (undercounts it.each and loops)
npm run feature-map -- --strict      # exit 1 if anything is unassigned
```

The exports are overwritten on each run. Generated files are not hand-edited: change `features.json` or the scripts and run again.

## How it works

| File | Job |
| --- | --- |
| `scripts/feature-map.mjs` | Entry point: collect, cache the raw inventory in `.cache/inventory.json`, render. |
| `scripts/collect.mjs` | Raw, ungrouped inventory. Parses every file under `src/`, `supabase/` and `public/` with the TypeScript parser in `node_modules/typescript` (no type checking): imports, route handlers and their `withUser`/`withPermission` wrappers, `.rpc()`/`.from()` calls, `/api/` URLs (following the constants and helpers in `src/lib/api/keys.ts`), env names, `defineTool` calls, the worker tick's jobs. Replays `supabase/migrations` (after `supabase/tests/support/legacy-bootstrap.sql` for pre-migration objects) to get the final tables, functions, RLS policies, triggers and buckets. Reads pgTAP `plan(n)` from `supabase/tests`. Runnable alone: `node scripts/collect.mjs --out inv.json`. |
| `scripts/group.mjs` | Assigns everything to features with `features.json`, works out links, builds the Unassigned list. |
| `scripts/render.mjs` | Writes the three exports. Runnable alone on a cached inventory: `node scripts/render.mjs [--in inv.json] [--out dir]`. |
| `scripts/lib/` | Glob matching, the SQL statement reader, the TypeScript scanner, and the HTML page (`page.css`, `page.js` are inlined). |

No dependencies beyond Node 24 and the repo's own `typescript` and `vitest`.

## Editing the feature mapping (`features.json`)

Each entry in `features` is:

```jsonc
{
  "id": "reminders",
  "name": "Reminders",
  "kind": "feature",                 // or "infrastructure" (shared plumbing; hidden from the Mermaid diagram)
  "summary": "One plain-English sentence.",
  "docs": ["docs/reminders-plan.md"],
  "paths": ["src/lib/reminders/**", "src/app/api/reminders/**", "supabase/tests/reminders_rls.sql"],
  "tables": ["reminders", "reminder_completions"],
  "sqlFunctions": ["public.reminders_guard", "public.claim_due_reminders"],
  "buckets": [],
  "diagram": true                    // optional: force a node into (or out of) the Mermaid diagram
}
```

Rules:

- **Paths** are repo-relative globs (`**`, `*`, `?`, `{a,b}`). Every file goes to the feature with the **most specific** matching pattern (longest text without wildcards), so `src/components/expenses/import/**` beats `src/components/expenses/**`. A test file no pattern matches follows the file it tests (`x.test.ts` → `x.ts`).
- **Tables** match table names (`public.` dropped; other schemas qualified, e.g. `expense_classification_private.*`). RLS policies, triggers and indexes follow their table.
- **sqlFunctions** match `schema.name` (`public.*calendar*`, `family_private.*`). A function no pattern matches goes to the feature of the table its trigger is on, else to the feature whose code calls it with `.rpc()` (if just one); otherwise it is unassigned.
- **MCP tools** belong to the feature that owns their file (`src/lib/mcp/tools/<x>.ts`), so map tool files to their domain feature. **Worker jobs** are listed under the worker and every feature whose tables or RPCs they touch. **Env vars** and **flags** belong to the features whose files read them.
- `ignore: [{ "path": "glob", "reason": "why" }]` hides files that deliberately belong nowhere (they are listed separately, with the reason).
- The top-level `scan`, `nav`, `flags`, `env`, `routes`, `mcp`, `worker` and `sql` blocks tell the collector where things live (navigation files, the flags file, the worker tick and store, the MCP server, the legacy bootstrap). Update them if those files move.

When a new module is added (new `src/lib/<x>/`, a migration, a page, an MCP tool file): add a feature or extend an existing one's `paths`, `tables` and `sqlFunctions`, then run again.

## Reading the output

- **At a glance / overview table**: counts per feature. Test cases come from `vitest list` (or the static count with `--static-tests`) plus each SQL test file's pgTAP `plan(n)`.
- **API routes → Access**: the wrapper per method (`withUser`, `withPermission(module, level)`, or `none (handles its own access)`), and `family flag` when the route calls `requireFamilyFeature()`. **Called from** lists the app files that request that route; "not called from app code" means only external clients (MCP apps, calendar apps, email links, monitoring) or nothing.
- **Database**: final state after all migrations. "RLS off" is shown in bold. "Tested by" is every SQL test that mentions the table or function.
- **Links**: "A depends on B" when A's code imports B, calls B's API routes, reads B's tables or calls B's SQL functions; when A's SQL (functions, policies, triggers it owns) uses B's objects; or, for the worker, when a job touches B's data. The kinds and examples are listed per link (`examples` in the JSON).

## After running: check Unassigned

**Always read the Unassigned list** (printed at the end of the run and at the bottom of `feature-map.md`). If it lists anything other than items that truly belong to no feature, update `features.json` and run again until it does. At the time of writing it holds only:

- `public.reset_daily_tokens()`: a legacy function that predates the migrations (stubbed in the bootstrap, run by pg_cron, unused by the app).
- `APP_CURRENCY`: in `.env.example` but read nowhere in `src/`.

## Known limits

- Static analysis only: dynamic imports with computed paths, URLs built at runtime from non-constant pieces, and `.from(variable)` table names are not seen.
- Table and function references inside SQL are found by name matching (a table counts only after FROM/JOIN/INTO/UPDATE/ON/… or when schema-qualified), not by parsing PL/pgSQL.
- Feature flags are code-level (`src/lib/features.ts` and the functions that wrap it). Database flags such as the AI kill switch in `app_flags`, and the client's `account.features`, are not tracked as flags.
- Worker jobs are the functions `tick()` calls in `src/lib/notifications/worker.ts`; their tables come from the store methods in `src/lib/supabase/worker-store.ts` they reach.
- File descriptions come from a file's header comment, or else the first exported declaration's JSDoc (shown as `` `name`: … ``).
