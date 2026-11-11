import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import local from "./eslint-rules/index.mjs";

/**
 * The project's own rules (eslint-rules/, explained in docs/lint-rules.md). Every rule is its own
 * name, so a block for some files can't replace another block's options the way a second
 * `no-restricted-syntax` does. A new rule is added to the plugin, to a block here and to
 * docs/lint-rules.md; a test checks all three.
 */
const localPlugin = { plugins: { local } };

/**
 * Components and pages no longer call `fetch` or `apiRequest`: their requests live in an API object
 * and hooks (like src/components/todos) or in a helper under src/lib. Every module is converted (U8
 * to U11 in docs/ui-plan.md), so the rule covers all of src/components and the app's pages.
 */
const CONVERTED_MODULES = [
  "src/components",
  "src/app/(app)",
];

/**
 * The modules that are the app's date formatters: the rule against `Intl.DateTimeFormat` and
 * `toLocale*String` exempts them, since they are where those calls belong. The general formatter
 * is src/lib/calendar.ts; the others format one domain's dates in one place each.
 */
const DATE_FORMATTER_MODULES = [
  "src/lib/calendar.ts",
  "src/lib/time-zone.ts",
  "src/lib/ai/month.ts",
  "src/lib/family/last-active-label.ts",
  "src/lib/family-calendar/view.ts",
  "src/lib/imports/recent.ts",
  "src/lib/imports/review.ts",
  "src/lib/reminders/format.ts",
];

const localRules = {
  files: ["src/**/*.{ts,tsx}"],
  rules: {
    // Injection guard (security plan S8): string-built PostgREST filters.
    "local/postgrest-filter-string": "error",
    "local/no-iso-date-slice": "error",
    "local/no-local-date-parse": "error",
    "local/no-redundant-swr-fetcher": "error",
    "local/stable-data-options": "error",
    "local/dnd-context-id": "error",
    "local/no-window-confirm": "error",
    "local/no-zod-flatten": "error",
  },
};

const dateFormatting = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: DATE_FORMATTER_MODULES,
  rules: { "local/no-locale-date-without-zone": "error" },
};

/** Requests belong to a converted module's API object, not to its components or pages. */
const noFetchInComponents = {
  files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
  ignores: ["src/app/api/**"],
  rules: { "local/no-fetch-in-components": ["error", { modules: CONVERTED_MODULES }] },
};

/**
 * UI guardrails: styling belongs to the theme (src/components/ui/theme) and
 * the primitives in src/components/ui. See "UI conventions" in README.md.
 */
const uiGuardrails = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/components/ui/**"],
  rules: {
    "local/theme-colors": "error",
    "local/theme-radius": "error",
    "local/theme-control-size": "error",
    "local/no-raw-dialog": "error",
    "local/no-subtle-text": "error",
  },
};

/**
 * Motion comes from the theme's tokens (src/components/ui/theme/motion.ts), and reduced motion is
 * handled in one place: global-css.ts for CSS, useReducedMotion() for JavaScript.
 */
const motion = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/components/ui/theme/**"],
  rules: { "local/motion-tokens": "error" },
};

/**
 * Chakra's factories and React's createContext only exist in the browser bundle. Called when a module
 * loads, they break `next build` for any server page that imports the module, even through the
 * @/components/ui barrel (PR #213), so such a module starts with "use client".
 */
const clientOnlyFactories = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/**/*.test.{ts,tsx}"],
  rules: { "local/client-only-chakra-factory": "error" },
};

/**
 * A section that streams in on the server (PF6) is a StreamedSection, not a bare <Suspense> with a
 * fallback: content streamed into a bare one lost the styles its fallback wrote first until the page
 * hydrated. The page files' own boundaries (around `useSearchParams`) never show their fallback on
 * the server and are left out until PF7 makes those pages stream; see docs/lint-rules.md.
 */
const streamedSection = {
  files: ["src/components/**/*.tsx", "src/app/**/*-client.tsx"],
  ignores: ["src/**/*.test.tsx", "src/components/ui/streamed-section.tsx"],
  rules: { "local/streamed-section": "error" },
};

/**
 * Chakra's Menu, Tooltip and the other floating panels bring a positioning library and a state machine
 * with them, about 26 KiB gzipped, so they load after the page (PF9): through `useLazyMenu`, with
 * `menu-parts.tsx` the one file that imports them.
 */
const lazyPopper = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/components/ui/menu-parts.tsx", "src/**/*.test.{ts,tsx}"],
  rules: { "local/lazy-popper": "error" },
};

const reducedMotion = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/hooks/use-reduced-motion.ts"],
  rules: { "local/no-reduced-motion-query": "error" },
};

/**
 * Storage and auth boundary: only these files may import Supabase or the
 * generated database types. Everything else goes through the repository and
 * auth interfaces. See "Shared names → Repositories and auth" in
 * docs/family-phase-1-tasks.md.
 */
const SUPABASE_BOUNDARY = [
  "src/lib/supabase/**",
  "src/lib/repositories.ts",
  "src/lib/auth/index.ts",
  "src/proxy.ts",
  // The worker's entry point wires the Supabase worker store, as repositories.ts does for the app.
  "src/worker/main.ts",
];

const BOUNDARY_MESSAGE =
  'Supabase stays behind the repository and auth interfaces. Use getRepositories() or getAuth() instead; see "Shared names → Repositories and auth" in docs/family-phase-1-tasks.md.';

const supabaseBoundary = {
  files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
  ignores: SUPABASE_BOUNDARY,
  rules: {
    // The Supabase packages.
    "no-restricted-imports": ["error", { patterns: [{ group: ["@supabase/*"], message: BOUNDARY_MESSAGE }] }],
    // Our Supabase code and the generated types. Matched on the resolved file,
    // so `@/lib/supabase/server` and `../supabase/server` are both caught.
    "import/no-restricted-paths": [
      "error",
      {
        basePath: import.meta.dirname,
        zones: [
          { target: ".", from: "./src/lib/supabase", message: BOUNDARY_MESSAGE },
          { target: ".", from: "./src/lib/database.types.ts", message: BOUNDARY_MESSAGE },
        ],
      },
    ],
  },
};

/**
 * The notifications worker is a plain Node process (`node worker.js`, bundled by esbuild): no Next
 * runtime and no request, so nothing it imports may need either.
 */
const WORKER_MESSAGE =
  "The worker runs outside Next.js with no request: no next/*, request-scoped Supabase clients, auth or getRepositories(). See R6 in docs/reminders-plan.md.";

const workerBoundary = {
  files: [
    "src/worker/**",
    "src/lib/notifications/worker.ts",
    "src/lib/notifications/worker-store.ts",
    "src/lib/notifications/push.ts",
    "src/lib/supabase/worker-store.ts",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          { group: ["next", "next/*", "@/lib/supabase/server", "@/lib/auth", "@/lib/auth/*", "@/lib/repositories"], message: WORKER_MESSAGE },
          // Restated from supabaseBoundary, whose option this rule replaces for these files.
          { group: ["@supabase/*"], message: BOUNDARY_MESSAGE },
        ],
      },
    ],
  },
};

/**
 * Server logs go through the shared logger (`src/lib/log`, logging plan L3), so a stray `console.*`
 * can't bypass its redaction, levels and request ids. Tests may use `console` (to spy on it or
 * silence it), and the statement eval is a command-line script that prints its report to a terminal.
 */
const noConsole = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/**/*.test.{ts,tsx}", "src/lib/imports/ai/__eval__/**"],
  rules: { "no-console": "error" },
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  localPlugin,
  localRules,
  dateFormatting,
  noFetchInComponents,
  uiGuardrails,
  motion,
  reducedMotion,
  lazyPopper,
  streamedSection,
  clientOnlyFactories,
  supabaseBoundary,
  workerBoundary,
  noConsole,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees and scratch output are not part of this project.
    ".claude/**",
    "tmp/**",
    // The worker bundle (npm run build:worker).
    "dist/**",
  ]),
]);

export default eslintConfig;
