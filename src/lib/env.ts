import "server-only";

import { z } from "zod";

import { parseLogLevel } from "@/lib/log";

/**
 * Every server environment variable, in one place. Server-only: it imports `server-only`, so a
 * client component that imports it fails the build.
 *
 * Two things live here:
 * - {@link serverEnvSchema}: how each variable is read. Reading never fails. A variable that is
 *   missing, empty or unusable gets the default the code has always used (an unset budget is $3 a
 *   family, an unset `FAMILY_ENABLED` is off), so the config modules that call {@link getEnv}
 *   behave as they did when they read `process.env` themselves.
 * - {@link checkEnv}: the startup check. Only a variable the process already cannot run without is
 *   required; it stops the process at start-up instead of at the first request that needs it.
 *   Everything else stays optional, and {@link optionalFeaturesOff} says what a gap switches off.
 *
 * Which process needs what:
 * - web (`node server.js`): `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; every request creates a
 *   Supabase client from them.
 * - worker (`node worker.js`): `SUPABASE_URL` and `SUPABASE_SECRET_KEY`; its store is the admin client.
 *
 * Not here on purpose: `NODE_ENV` and `NEXT_RUNTIME` (set by Node and Next.js, not configuration)
 * and `NEXT_PUBLIC_SW_IN_DEV` (public, read by the browser bundle, so it can't come from a
 * server-only module).
 *
 * SECURITY: nothing here logs or returns a value in a message, only variable names.
 */

/** What a family may spend on AI in a month when `AI_FAMILY_MONTHLY_USD` isn't set. */
export const DEFAULT_FAMILY_MONTHLY_USD = 3;
/** What everyone may spend in a month when `AI_MONTHLY_BUDGET_USD` isn't set: about three families' worth. */
export const DEFAULT_GLOBAL_MONTHLY_USD = 10;

/**
 * How many `X-Forwarded-For` hops our own proxies add when `TRUSTED_PROXY_HOPS` isn't set: one, the
 * address the proxy in front of the container saw (Tailscale Serve on the VPS).
 */
export const DEFAULT_TRUSTED_PROXY_HOPS = 1;
/** The most hops `TRUSTED_PROXY_HOPS` may name. */
export const MAX_TRUSTED_PROXY_HOPS = 5;

/** How long a request may take, in milliseconds, before its request line is a `warn` with `slow: true`, when `LOG_SLOW_MS` isn't set. */
export const DEFAULT_LOG_SLOW_MS = 1000;
/** The longest `LOG_SLOW_MS` may name: an hour. */
const MAX_LOG_SLOW_MS = 3_600_000;

/** Where variables are read from: `process.env`, or a plain record in tests. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Text without surrounding spaces; empty and unset are both `undefined`. */
const optionalText = z
  .string()
  .optional()
  .transform((value) => value?.trim() || undefined);

/** A dollar amount: a number of zero or more, else `fallback`. */
function optionalUsd(fallback: number) {
  return z
    .string()
    .optional()
    .transform((value) => {
      const text = value?.trim();
      if (!text) return fallback;
      const parsed = Number(text);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    });
}

/** A whole number from `min` to `max`, else `fallback` (unset, empty, not a number, or out of range). */
function optionalInteger({ fallback, min, max }: { fallback: number; min: number; max: number }) {
  return z
    .string()
    .optional()
    .transform((value) => {
      const text = value?.trim();
      if (!text || !/^\d+$/.test(text)) return fallback;
      const parsed = Number(text);
      return parsed >= min && parsed <= max ? parsed : fallback;
    });
}

/** A comma-separated list of user ids; anything that isn't one is ignored, and the list may be empty. */
const optionalUserIds = z
  .string()
  .optional()
  .transform((value) => {
    const ids = (value ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter((id) => USER_ID.test(id));
    return [...new Set(ids)];
  });

/**
 * Every variable the server reads. Every field is lenient (see the file comment); which ones a
 * process cannot start without is {@link webRequiredSchema} and {@link workerRequiredSchema}.
 */
export const serverEnvSchema = z.object({
  // Supabase. Required for the web app (URL and publishable key) and the worker (URL and secret key).
  SUPABASE_URL: optionalText,
  SUPABASE_PUBLISHABLE_KEY: optionalText,
  /** Bypasses every database rule (RLS). Optional for the web app: only the features that need it fail without it. */
  SUPABASE_SECRET_KEY: optionalText,

  // The app's own address and its helpers.
  /** The public address of the app; sign-in links and MCP use the request's own address when it's unset. */
  SITE_URL: optionalText,
  /**
   * How many proxies in front of the app add a hop to `X-Forwarded-For`, which decides the client IP
   * the rate limits use (`clientIp`). 1 (the default) is one proxy, such as Tailscale Serve; 2 is
   * two in a row; 0 trusts the header not at all and puts every client in one shared bucket.
   */
  TRUSTED_PROXY_HOPS: optionalInteger({ fallback: DEFAULT_TRUSTED_PROXY_HOPS, min: 0, max: MAX_TRUSTED_PROXY_HOPS }),
  /** The investment price service; quote lookups fail without it. */
  PRICE_SERVICE_URL: optionalText,
  /** The family module is on only when this is exactly `true`. */
  FAMILY_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === "true"),

  // Web Push. The web app reads the public key; the worker needs all three to send.
  VAPID_PUBLIC_KEY: optionalText,
  VAPID_PRIVATE_KEY: optionalText,
  VAPID_SUBJECT: optionalText,

  // AI. Off unless AI_PROVIDER, its key and the feature's model are all set.
  AI_PROVIDER: optionalText,
  OPENAI_API_KEY: optionalText,
  /** The model of the `statements` feature (`modelEnv` in `src/lib/ai/index.ts`). A new feature's model variable goes here too. */
  AI_MODEL_STATEMENTS: optionalText,
  AI_FAMILY_MONTHLY_USD: optionalUsd(DEFAULT_FAMILY_MONTHLY_USD),
  AI_MONTHLY_BUDGET_USD: optionalUsd(DEFAULT_GLOBAL_MONTHLY_USD),
  APP_ADMIN_USER_IDS: optionalUserIds,

  // Logging (src/lib/log).
  /** The lowest level written: `debug`, `info`, `warn` or `error`. Anything else, or unset, is `info`. */
  LOG_LEVEL: z
    .string()
    .optional()
    .transform((value) => parseLogLevel(value)),
  /** A request slower than this many milliseconds is logged at `warn` with `slow: true`. A whole number of 1 or more; 1000 when unset or invalid. */
  LOG_SLOW_MS: optionalInteger({ fallback: DEFAULT_LOG_SLOW_MS, min: 1, max: MAX_LOG_SLOW_MS }),

  // The worker.
  /** The build written with the worker's heartbeat; the package version when it's unset. */
  GIT_SHA: optionalText,
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * The server's variables, read from `source` (default `process.env`). Never throws and never
 * caches, so a test that stubs a variable sees it on the next call.
 */
export function parseServerEnv(source: EnvSource = process.env): ServerEnv {
  return serverEnvSchema.parse(source);
}

/** The server's variables, read from `process.env` now. */
export function getEnv(): ServerEnv {
  return parseServerEnv();
}

/**
 * The AI variables by name, for `structured` in `src/lib/ai/index.ts`, which looks a feature's model
 * up by the variable's name (`modelEnv`).
 */
export function getAiEnv(source?: EnvSource): Record<string, string | undefined> {
  const env = parseServerEnv(source);
  return {
    AI_PROVIDER: env.AI_PROVIDER,
    OPENAI_API_KEY: env.OPENAI_API_KEY,
    AI_MODEL_STATEMENTS: env.AI_MODEL_STATEMENTS,
  };
}

// ---------------------------------------------------------------------------------------------
// The start-up check.
// ---------------------------------------------------------------------------------------------

const requiredText = z.string({ error: "is missing" }).trim().min(1, "is empty");

const httpUrl = requiredText.refine((value) => {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}, "is not an http(s) URL");

const requiredShape = z.object({
  SUPABASE_URL: httpUrl,
  SUPABASE_PUBLISHABLE_KEY: requiredText,
  SUPABASE_SECRET_KEY: requiredText,
});

/** What the web app cannot run without: `getSupabaseConfig()` throws when either is missing. */
export const webRequiredSchema = requiredShape.pick({ SUPABASE_URL: true, SUPABASE_PUBLISHABLE_KEY: true });
/** What the worker cannot run without: its store is the admin client, which needs the URL and the secret key. */
export const workerRequiredSchema = requiredShape.pick({ SUPABASE_URL: true, SUPABASE_SECRET_KEY: true });

export type EnvProcess = "web" | "worker";

export type EnvCheck = { ok: true } | { ok: false; problems: string[] };

/**
 * Checks the variables `kind` cannot start without. `problems` has one line per variable, naming
 * it and saying what is wrong (`SUPABASE_URL is missing`); never its value.
 */
export function checkEnv(kind: EnvProcess, source: EnvSource = process.env): EnvCheck {
  const schema = kind === "web" ? webRequiredSchema : workerRequiredSchema;
  const result = schema.safeParse(source);
  if (result.success) return { ok: true };

  const byName = new Map<string, string>();
  for (const issue of result.error.issues) {
    const name = String(issue.path[0]);
    // The first issue per variable is the most basic one (missing before empty before not a URL).
    if (!byName.has(name)) byName.set(name, `${name} ${issue.message}`);
  }
  return { ok: false, problems: [...byName.values()] };
}

/** The message a process stops with, naming each variable that is missing or invalid and no value. */
export function formatEnvFailure(kind: EnvProcess, problems: readonly string[]): string {
  const who = kind === "web" ? "the web app" : "the worker";
  return [
    `Cannot start ${who}: required environment variables are missing or invalid.`,
    ...problems.map((problem) => `  - ${problem}`),
    "Set them in the container's env file (see .env.example) and start again. Values are never printed.",
  ].join("\n");
}

/**
 * The optional features the web app has no settings for, each as `feature (VARIABLE, …)` naming
 * what is missing. Empty when everything is set. Nothing here stops the app.
 */
export function optionalFeaturesOff(source: EnvSource = process.env): string[] {
  const env = parseServerEnv(source);
  const off: string[] = [];
  if (!env.SUPABASE_SECRET_KEY) {
    off.push("kid accounts, username sign-in, profile pictures and AI budgets (SUPABASE_SECRET_KEY)");
  }
  if (!env.SITE_URL) off.push("a fixed site address for links and MCP (SITE_URL)");
  if (!env.PRICE_SERVICE_URL) off.push("investment prices (PRICE_SERVICE_URL)");
  if (!env.VAPID_PUBLIC_KEY) off.push("browser notifications (VAPID_PUBLIC_KEY)");
  const missingAi = (["AI_PROVIDER", "OPENAI_API_KEY", "AI_MODEL_STATEMENTS"] as const).filter((name) => !env[name]);
  if (missingAi.length > 0) off.push(`AI (${missingAi.join(", ")})`);
  if (!env.FAMILY_ENABLED) off.push("the family module (FAMILY_ENABLED is not true)");
  return off;
}
