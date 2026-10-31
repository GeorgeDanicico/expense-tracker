---
name: find-simpler-ways
description: Investigates whether existing code in this repo could be simpler, with less boilerplate, and writes a ranked report of concrete proposals to docs/simplification/<target>.md without changing any code. Use when asked "is there a simpler way", "too much boilerplate", "reduce boilerplate in X", "find simpler implementations", "could this be simpler", "where are we repeating ourselves", or to review a path, a module (e.g. "reminders"), a pattern (e.g. "route handlers", "SWR hooks", "zod schemas") or the whole repo for simplification. Use /simplify instead to clean up and apply fixes to the current diff; use this skill for existing code and when you want proposals, not edits.
---

# Find simpler ways

Look at existing code and answer one question: **could this be done with less code, fewer layers, or a library feature we already have, without changing what it does?** The result is a report of ranked proposals. You do not edit source files.

How this differs from `/simplify`: `/simplify` reviews the **current diff** and **applies** fixes. This skill reviews **code that is already merged** (a path, a module, a pattern, or the whole repo) and only **proposes**. If the user wants the proposals applied afterwards, that is a separate task.

## Ground rules

- **Read-only.** The only file you write is the report, `docs/simplification/<target-slug>.md` (create `docs/simplification/` if it doesn't exist). Don't edit code, don't commit, don't switch branches, don't stash.
- **Next.js here is version 16 and differs from what you remember.** Read `AGENTS.md`, then the relevant pages in `node_modules/next/dist/docs/` before proposing anything that touches Next APIs. Check the installed version of every library you lean on in `package.json`.
- **Ignore** `.claude/worktrees/` (stale copies of the repo), `tmp/`, `node_modules/`, `.next/`, `dist/`, and generated files such as `src/lib/database.types.ts`.
- **Prefer deleting code to adding abstractions.** A proposal that adds a helper must remove clearly more than it adds, and the call sites must read at least as clearly as before.
- **Write in plain, clear English.** Short sentences, concrete nouns, no jargon where a plain word works. George reads these reports to decide what to do.

## Method

### 1. Pin down the target

Turn the request into a list of files and a slug:

| Request | Files | Slug |
|---|---|---|
| A path (`src/lib/todos`) | That folder or file | `lib-todos` |
| A module (`reminders`) | `src/lib/<m>`, `src/app/api/<m>`, `src/components/<m>`, `src/lib/mcp/tools/<m>.ts`, `src/lib/supabase/repositories/<m>.ts`, `src/test/fakes/<m>.ts`, `src/lib/validation/<m>.ts`, plus its tests (the script below lists them when given the bare name) | `reminders` |
| A pattern (`route handlers`, `SWR hooks`, `zod schemas`, `repositories`, `dialogs`, `MCP tools`) | Every file of that kind (e.g. `src/app/**/route.ts`) | `route-handlers` |
| The whole repo | `src` | `whole-repo` |

Use `ls`/`find`/`grep` to confirm the files exist; module names don't always match folder names (e.g. calendar lives in `src/lib/family-calendar`). For the whole repo, do a quick pass over every area, then go deep only on the three or four areas with the most repetition.

### 2. Map it and count the shapes

Run the helper script. It parses the code with the repo's own TypeScript and prints leads in Markdown:

```bash
node .claude/skills/find-simpler-ways/scripts/find-shapes.mjs <paths or a module name...>
# e.g. src/lib/todos src/app/api/todos   or just: reminders
# narrower: --sections=map,routes   more rows: --top=30   raw data: --json   help: --help
```

A bare module name (`reminders`) expands to every file named after it, in any folder, which is a good first list for step 1. It takes about four seconds on the whole repo. It looks for repeats across all of `src` and shows a finding when at least one place is in your target. Sections:

- **map**: lines, exports, importers per file, and exports nobody imports.
- **clones**: functions with the same structure once names and literals are ignored; top-level functions with the same name in several files.
- **files**: near-duplicate files by token shape.
- **routes**: each route handler's wrapper and the order of shared helper calls, skeletons shared between handlers, handlers without a wrapper, hand-written `{ params: Promise<…> }` types.
- **hooks**: SWR reads, the same `useSWR(key)` in several places, `fetch` calls, hand-kept pending/error state, hooks defined twice.
- **schemas**: `z.object` key sets that are identical or mostly overlap, field definitions written out three or more times.
- **wrappers**: named functions that only forward to one call, re-export-only files, interface-like types and where they are implemented.
- **tests**: test cases in one file with the same structure (`it.each` candidates), route tests that re-check the anonymous-caller 401, the same `vi.mock` in many files.

The script's output is **leads, not findings.** Many repeats are fine (see "Leave these alone" below). Then read the code yourself:

- Read every target file in full if the target is small (under ~1,500 lines); otherwise read the files the script flags plus one typical file of each kind.
- For each exported function, know who calls it (`grep -rn "name" src`). An export used once, from one place, may want inlining; one never imported may be dead.
- Also read the target's **neighbours**: the files the map lists as importers, and the files the script pairs with your target (a clone in another module, a same-named helper). Some of the best findings sit between the target and its neighbours.
- Write down the counts you'll quote: "8 route files declare the same context type", "3 components define `useNow`". Give both the count in the target and the count across the repo, so a small fix that applies everywhere is visible.

### 3. Check what is already there before proposing a helper

Before you suggest writing anything:

1. **This repo.** Shared helpers often exist already and are just not used everywhere. Look in `src/lib/http/route.ts` (`withUser`, `json`, `noContent`, `parseId`, `parseBody`, `parseInput`, `notFound`, `HttpError`), `src/lib/http/permission.ts` (`withPermission`), `src/lib/repositories.ts`, `src/lib/api/` (`client.ts`, `keys.ts`, `invalidate.ts`), `src/hooks/` (`use-api-form.ts`, `use-account.ts`), `src/lib/validation/primitives.ts`, `src/lib/mcp/define-tool.ts`, `src/lib/errors.ts`, `src/lib/calendar.ts`, `src/lib/time-zone.ts`, `src/lib/utils/`, `src/components/ui/`, and in tests `src/test/route.ts`, `src/test/builders.ts`, `src/test/fakes/`, `src/test/fake-supabase.ts`.
2. **The installed libraries.** Read the version in `package.json`, then the library's own docs or types in `node_modules`: Next 16 in `node_modules/next/dist/docs/` (grep it), zod 4 in `node_modules/zod/v4/` types, SWR 2 in `node_modules/swr/dist/**/*.d.ts`, Chakra v3 in `node_modules/@chakra-ui/react/dist/types/`, supabase-js in `node_modules/@supabase/supabase-js/dist/` (and its `AGENTS.md`), decimal.js in `decimal.d.ts`, vitest in its `.d.ts` files. Quote the doc file or type you relied on in the proposal. Mark anything documented as experimental, alpha or deprecated, and treat it as higher risk.
3. **Prove library behaviour you depend on.** If a proposal relies on how a library behaves (what `.partial()` does with `.default()`, whether SWR revalidates after `mutate`), check it with a one-line `node -e` against the installed package, and quote the result. Reading the types is not enough: in zod 4, for example, `.partial()` keeps defaults, so a "partial of the create schema" is not the same as a patch schema.

`references/checklist.md` lists what to look for in each kind of file and the library features worth checking first.

Know which guarantees are already tested in one place, so you can spot tests that repeat them: `src/lib/http/route.test.ts` (`withUser`: 401 without calling the handler, error mapping, the no-store header), `src/lib/http/permission.test.ts` (`withPermission`), `src/app/api/protected-routes.test.ts` (every API handler rejects an anonymous caller), and `src/lib/mcp/tool-surface.test.ts` with its snapshot (the MCP tool surface). `requireFamilyFeature()` has no central test, so the per-route "flag is off" tests are the only proof each route calls it; they stay.

Also read earlier plans so you don't re-propose finished or rejected work: `docs/code-cleanup-plan.md`, `docs/archive/`, `docs/simplification/`, and `docs/codebase-audit.md` if it exists.

### 4. Look for these

- **Wrappers that only forward**: a function, hook or module that passes its arguments straight to one other call and adds nothing (no name that explains intent, no narrowing, no test seam).
- **One-implementation interfaces** outside the repository pattern: a type with one implementer and no fake, where the indirection buys nothing.
- **Repeated skeletons** that a small factory, a table or a generic would replace: route handlers, repository methods, SWR hooks, API clients (`*-api.tsx`), dialogs and forms, MCP tools, zod schemas (`.extend`, `.pick`, `.omit`, `.partial`), test files.
- **Config that could be data**: `if`/`switch` ladders or parallel functions that differ only in a constant, which a lookup table would replace.
- **Hand-rolled code a library already does**: date maths, URL building, deep equality, retry, debouncing, zod refinements a built-in check covers, SWR features (`keepPreviousData`, `fallbackData`, `useSWRMutation`, `optimisticData`, `populateCache`), Next helpers (the global `RouteContext<'/path/[id]'>` type, `after()`, `notFound()`), Chakra recipes and slot recipes instead of repeated style props.
- **Layers that add nothing**: a service function that only calls the repository, a file that only re-exports, a type that only renames another.
- **Dead code**: exports nobody imports, branches that can't run, options nobody passes.
- **Tests that repeat the same case**: copy-pasted cases differing in one value or one setup call (`it.each`), a guarantee re-tested in every route when it is already tested in one place (see step 3), setup copied across files that belongs in `src/test`.

### 5. Turn leads into proposals

For each candidate, write it up as below. Drop it if you can't name the tests that would prove behaviour is unchanged.

- **What and why**, in one or two sentences.
- **Before / after** sketch: a few lines of real code from the repo, then the proposed version. Keep sketches short; show one call site, not all of them.
- **Files affected**, with counts.
- **Lines saved**: a rough net number (lines removed minus lines added), measured with `wc -l` or by counting the repeated block × call sites. If the payoff is something else (a type now checked against the folder, one place to change a rule), say that plainly rather than inflating the line count.
- **Risk**: low (mechanical, type-checked), medium (touches behaviour that tests cover), high (changes an API response, a SWR key, an MCP tool surface, or relies on an experimental feature). Say what could break. For anything that depends on build steps or generated files, check what CI actually runs in `.github/workflows/ci.yml` (it runs `npx next typegen` before `npm run typecheck`, for example).
- **Proof**: which existing tests cover it (file paths), and what would need adding. Always include `npm run typecheck`, `npm test`, and `npm run lint`; add `npm run build` for Next changes and `npm run test:db` for repository changes.

### 6. Rank, reject, and keep the rejects

Rank by **payoff against risk**: lines and concepts removed, how often people touch that code, and how likely a mistake is. A safe deletion of 15 lines beats a risky factory saving 60.

Reject a proposal, and say so in the report, when:

- the abstraction is harder to read than the repetition (the reader must jump to a helper to understand a five-line handler);
- it saves fewer than about 10 lines across the codebase and adds a new concept;
- the copies are likely to drift apart on purpose (different domains with similar shapes today);
- it would change a response body, status, header, SWR key, URL, or MCP tool name, title, description or input shape;
- it breaks a convention listed below.

Listing rejected ideas with one line each is useful: it stops the next reader proposing them again.

### Leave these alone (the repo's conventions)

These look like boilerplate but are deliberate. Don't propose removing them; do propose using them where code bypasses them.

- **`withUser` / `withPermission`** wrap every authenticated route. Handlers stay short and explicit: `requireFamilyFeature()`, `parseId`, `parseBody`, one domain call, `json`. Merging several handlers into a generic "CRUD route factory" hides that sequence and is usually a reject.
- **Repository interfaces** (`src/lib/*/repository.ts`) with one Supabase implementation (`src/lib/supabase/repositories/`) and one in-memory fake (`src/test/fakes/`), wired in `src/lib/repositories.ts`. Two implementations is the point: it's the test seam.
- **Service files** (`src/lib/*/service.ts`) hold use cases shared by REST routes and MCP tools. A thin service function that only calls the repository may still be right if both transports use it; check before calling it a layer that adds nothing.
- **Route tests** mock `@/lib/auth` and swap `@/lib/repositories` for the fakes with one `vi.mock` line each. Those repeated lines are the convention, not a smell.
- **MCP tools** are declared through `defineTool` in `src/lib/mcp/define-tool.ts`; their names, descriptions and shapes are a public surface with snapshot tests.
- **`server-only`** imports, the `PRIVATE_HEADERS` no-store header, and doc comments that explain "why" stay.

## Report

Write `docs/simplification/<target-slug>.md`:

~~~markdown
# Simpler ways: <target>

<One paragraph: what was looked at (files, line count), how, and the headline: how many proposals, how many lines they'd save in total, and the one most worth doing.>

## Map

<Short: the files, what each does, who calls what. A small table is fine. Counts of the repeated shapes.>

## Proposals

| # | Proposal | Lines saved | Risk | Files |
|---|---|---|---|---|
| 1 | ... | ~40 | Low | 8 |

### 1. <Title as an action, e.g. "Use Next's RouteContext type instead of eight local copies">

**Why.** ...

**Before**
```ts
...
```

**After**
```ts
...
```

**Files.** ... **Lines saved.** ~N. **Risk.** Low: ... **Proof.** `src/app/api/.../route.test.ts`, `npm run typecheck`, ...

## Tidy-ups

<Optional: changes that save no lines but are worth doing while nearby, such as dropping `export` from a name nothing imports. One line each.>

## Considered and rejected

- <Idea>: <one-line reason>.

## Already simple

<Optional: parts that looked like candidates but are fine as they are, and why. Keeps the next reader from re-checking them.>

## Leads outside this target

<Optional: repeats you noticed that reach beyond the target, with counts, as candidates for a later run.>
~~~

Keep the report as short as the findings allow. A small target with two good proposals should be a short report. If the area is already lean, say so in the first paragraph; that's a useful result, not a failure. Don't pad the table with zero-payoff items to make it look fuller; put them under "Tidy-ups", "Considered and rejected" or "Already simple".

Then reply in chat with: the report path, the top three proposals in one line each (with lines saved and risk), and the total. Don't paste the whole report.
