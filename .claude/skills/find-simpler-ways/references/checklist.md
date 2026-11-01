# Checklist: what to look for, by kind of file

Use this while reading the target. Each line is a question; a "yes" is a lead worth checking, not a finding.

## Route handlers (`src/app/**/route.ts`)

- Does a handler skip `withUser` / `withPermission` when it needs a signed-in user? (Public routes such as `/health`, `/auth/*` and the calendar feed are meant to.)
- Does it build a `NextResponse` by hand where `json`, `noContent` or `notFound` from `src/lib/http/route.ts` would do?
- Does it parse the body or query with `safeParse` and a hand-written 422, instead of `parseBody` / `parseInput`?
- Does it declare its own `type XRouteContext = { params: Promise<{ id: string }> }`? Next 16 generates a global `RouteContext<'/api/x/[id]'>` (see `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`, "Route Context Helper"). The type only exists after `next dev`, `next build` or `next typegen`. CI runs `npx next typegen` before `npm run typecheck`, and the app already relies on the generated `PageProps` / `LayoutProps`, so this is low risk. The script's routes section lists every hand-written context type, named or inline.
- Do several handlers repeat the same lines before their one domain call? Count them. Five shared lines across 40 handlers may be fine (explicit, greppable); a 15-line block across 6 handlers usually isn't.
- Does a handler reach into `getRepositories()` and then reshape the result in the same way another route or an MCP tool does? That use case may belong in the module's `service.ts`.

## Services and repositories (`src/lib/*/service.ts`, `repository.ts`, `src/lib/supabase/repositories/*`)

- Is there a service function that only calls one repository method with the same arguments? Keep it if both REST and MCP use it, or if it sets a default; otherwise the route can call the repository.
- Do Supabase repositories repeat the same select column list, row mapper, error-code translation or `toIso`-style helper? A shared helper in `src/lib/supabase/` may fit.
- Do two repositories hand-write the same "load family members, then join display fields" step?
- Are row types hand-written where `Database["public"]["Tables"][...]["Row"]` from `src/lib/database.types.ts` would do?
- Are there `as unknown as` casts that a typed `.select()` string or `.overrideTypes<T>()` would remove? (`.returns<T>()` is deprecated in the installed postgrest-js; see `node_modules/@supabase/postgrest-js/dist/index.d.mts`.)

## MCP tools (`src/lib/mcp/tools/*`)

- Does a tool re-declare a zod schema that `src/lib/validation/*` already has, with only names changed (`assignee` vs `assigneeMemberId`)? A `.extend()` / `.pick()` or a small key mapping may remove it. The advertised input shape must not change; `src/lib/mcp/tool-surface.test.ts` and its snapshot prove that.
- Does a tool repeat a use case that a route also implements? Move it to `service.ts` and call it from both.

## zod schemas (`src/lib/validation/*`)

- Are two `z.object`s the same apart from one or two keys? zod 4 has `.extend()`, `.pick()`, `.omit()`, `.partial()`, `.required()` and `z.object({...shape.shape, more})` spreading.
- Is the same field definition written out three or more times (`z.string().trim().max(200)`)? Put it in `src/lib/validation/primitives.ts`.
- Is a `.refine()` doing what a built-in does? zod 4 has `z.uuid()`, `z.iso.date()`, `z.iso.datetime()`, `z.email()`, `z.url()`, `.min/.max/.length`, `z.enum()`, `z.stringbool()`, `z.coerce.*`. Check the exact messages: replacing a refine can change the error text the client shows.
- Are field errors flattened by hand where `z.flattenError()` or `parseInput` already does it?

## Client data (`src/components/**`, `src/hooks/**`, `src/lib/api/*`)

- Is the same `useSWR(KEY)` called in several components? A named hook (like `useAccount`) gives one place for the fallback and type.
- Are SWR keys built by string concatenation instead of `src/lib/api/keys.ts`?
- Is cache invalidation written inline instead of through `src/lib/api/invalidate.ts`?
- Does a component keep `pending` / `error` / `fieldErrors` state by hand where `useApiForm` in `src/hooks/use-api-form.ts` would do?
- Does a `*-api.tsx` client repeat `apiRequest(url, { method, body: JSON.stringify(x) })` for every method? A tiny `send(method, url, body)` may remove the noise, or may not be worth it; count first.
- SWR 2 features worth checking before writing your own: `fallbackData`, `keepPreviousData`, `mutate(data, { optimisticData, rollbackOnError, populateCache, revalidate })`, `useSWRMutation` (`swr/mutation`), `useSWRInfinite`, `preload`. Types live in `node_modules/swr/dist/**/index.d.ts`.

## Components (`src/components/**`)

- Are there two components that differ only in a prop or a label? (e.g. `main-expenses-panel` and `family-expenses-panel`.)
- Is the same small helper (`memberLabel`, `memberName`, `useNow`, `Chip`) defined in several files?
- Are Chakra style props repeated across many elements where a recipe, slot recipe, or one of the shared parts in `src/components/ui/` would do? Chakra v3 types: `node_modules/@chakra-ui/react/dist/types/`. Visual changes are out of scope for this skill unless asked; propose only changes that render the same.

## Tests (`*.test.ts(x)`, `src/test/**`)

- Several `it` blocks differing in one value or one setup call (`asOutsider` versus `asLoner`): `it.each` (or `describe.each`) is shorter and lists the cases as data. Keep the printed test names the same.
- The same 401 case tested in every route: `src/lib/http/route.test.ts` proves `withUser` answers 401 without calling the handler, and `src/app/api/protected-routes.test.ts` checks every API handler does. A per-route "anonymous caller" test repeats both. (Per-route "family flag is off" tests are different: nothing else proves the route calls `requireFamilyFeature()`.)
- The same 403 case in every route: `src/lib/http/permission.test.ts` covers `withPermission`; a route needs its own 403 test only for a rule of its own.
- A helper (`memoryLog`, `wrap`, a fake client) copied into several test files: move it to `src/test/`.
- A test-local fake where `src/test/fakes/*` or `src/test/fake-supabase.ts` already exists.

## Library features worth checking first

| Library (version in package.json) | Look in | Often-missed features |
|---|---|---|
| next 16.3 | `node_modules/next/dist/docs/` (grep) | `RouteContext` / `PageProps` / `LayoutProps` global types, `after()`, `notFound()`, `connection()`, `catchError` (`next/error`); `unauthorized()` / `forbidden()` and `useOffline` are experimental |
| zod 4 | `node_modules/zod/v4/core/*.d.ts`, `node_modules/zod/v4/classic/` | `.extend/.pick/.omit/.partial`, `z.iso.*`, `z.stringbool()`, `z.flattenError`, `z.prettifyError`, `.meta()` |
| swr 2 | `node_modules/swr/dist/**/index.d.ts` | `useSWRMutation`, `keepPreviousData`, `optimisticData`, `populateCache`, `preload`, `SWRConfig` `fallback` |
| @chakra-ui/react 3 | `node_modules/@chakra-ui/react/dist/types/` | recipes, slot recipes, `defineRecipe`, `chakra()` factory, compound components |
| @supabase/supabase-js 2 | `node_modules/@supabase/supabase-js/AGENTS.md`, `node_modules/@supabase/postgrest-js/dist/index.d.mts` | typed `.select()` strings, `.overrideTypes<T>()` (not the deprecated `.returns<T>()`), `.maybeSingle()`, `.throwOnError()` |
| decimal.js 10 | `node_modules/decimal.js/decimal.d.ts` | `Decimal.sum`, `toFixed`, `toDecimalPlaces`, `Decimal.set` |
| vitest 3 | `node_modules/vitest/dist/*.d.ts` | `it.each` / `describe.each` with objects, `vi.mocked`, `expect.objectContaining`, `toMatchObject` |

Always confirm a feature exists in the installed version before proposing it. Quote the file you checked.
