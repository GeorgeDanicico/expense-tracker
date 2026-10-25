import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const COLOR_PROPS = "/^(color|bg|bgColor|background|backgroundColor|borderColor|fill|stroke)$/";
const HEX = "/^#[0-9a-fA-F]{3,8}$/";
const THEME_PALETTES = "/^(brand|neutral|danger|success|warning|info)$/";
const CONTROLS = "/^(Button|IconButton|Input|Textarea)$/";
const MEMBER_CONTROLS =
  "JSXOpeningElement[name.type='JSXMemberExpression'][name.object.name=/^(NativeSelect|Dialog|Tabs)$/][name.property.name=/^(Field|Content|Trigger)$/]";

/**
 * UI guardrails: styling belongs to the theme (src/components/ui/theme) and
 * the primitives in src/components/ui. See "UI conventions" in README.md.
 */
const uiGuardrails = {
  files: ["src/**/*.{ts,tsx}"],
  ignores: ["src/components/ui/**"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: `JSXAttribute[name.name=${COLOR_PROPS}] Literal[value=${HEX}]`,
        message: "Use a colour token (e.g. fg.muted, status.warning.fg) instead of a hex value.",
      },
      ...[
        `JSXAttribute[name.name="colorPalette"] > Literal`,
        `JSXAttribute[name.name="colorPalette"] > JSXExpressionContainer > Literal`,
        `JSXAttribute[name.name="colorPalette"] ConditionalExpression > Literal.consequent`,
        `JSXAttribute[name.name="colorPalette"] ConditionalExpression > Literal.alternate`,
      ].map((literal) => ({
        selector: `${literal}:not([value=${THEME_PALETTES}])`,
        message: "Use a theme palette: brand, neutral, danger, success, warning or info.",
      })),
      {
        selector: `JSXOpeningElement[name.name=${CONTROLS}] > JSXAttribute[name.name=/^(borderRadius|rounded)$/]`,
        message: "Control radius comes from the theme recipe; remove borderRadius.",
      },
      {
        selector: `${MEMBER_CONTROLS} > JSXAttribute[name.name=/^(borderRadius|rounded)$/]`,
        message: "Control and dialog radius comes from the theme recipe; remove borderRadius.",
      },
      {
        selector: `JSXOpeningElement[name.name=${CONTROLS}] > JSXAttribute[name.name=/^(minH|minHeight)$/][value.value=/^(11|14)$/]`,
        message: "Controls use theme sizes (xs/sm/md); don't force 44px minimum heights.",
      },
      {
        selector: `${MEMBER_CONTROLS} > JSXAttribute[name.name=/^(minH|minHeight)$/][value.value=/^(11|14)$/]`,
        message: "Controls use theme sizes (xs/sm/md); don't force 44px minimum heights.",
      },
    ],
  },
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

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  uiGuardrails,
  supabaseBoundary,
  workerBoundary,
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
