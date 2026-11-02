import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkEnv,
  formatEnvFailure,
  getAiEnv,
  getEnv,
  optionalFeaturesOff,
  parseServerEnv,
  webRequiredSchema,
  workerRequiredSchema,
} from "@/lib/env";

const SRC = join(__dirname, "..");
const ADMIN = "0a1b2c3d-0000-4000-8000-000000000001";

const web = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" };
const worker = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x" };

afterEach(() => vi.unstubAllEnvs());

describe("env.ts is server-only", () => {
  it("imports server-only before anything else, so a client bundle that reaches it fails the build", () => {
    const source = readFileSync(join(SRC, "lib/env.ts"), "utf8");
    const firstImport = source.split("\n").find((line) => line.startsWith("import "));
    expect(firstImport).toBe('import "server-only";');
  });

  it("is refused by the real server-only package outside the server", () => {
    // Vitest aliases `server-only` to an empty file; without the `react-server` condition (a client
    // bundle) the package itself throws, and that is what fails `next build` for a client import.
    expect(() => createRequire(import.meta.url)("server-only")).toThrow(/Client Component/);
  });

  it("is not imported by any client component", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) {
          const source = readFileSync(path, "utf8");
          if (/^["']use client["']/m.test(source) && /from ["']@\/lib\/env["']/.test(source)) offenders.push(path);
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

describe("checkEnv", () => {
  it("passes the web app with the Supabase URL and the publishable key", () => {
    expect(checkEnv("web", web)).toEqual({ ok: true });
  });

  it("passes the worker with the Supabase URL and the secret key", () => {
    expect(checkEnv("worker", worker)).toEqual({ ok: true });
  });

  it("doesn't need the secret key in the web app or the publishable key in the worker", () => {
    expect(checkEnv("web", web).ok).toBe(true);
    expect(checkEnv("worker", worker).ok).toBe(true);
  });

  it("names every missing required variable of the web app", () => {
    expect(checkEnv("web", {})).toEqual({
      ok: false,
      problems: ["SUPABASE_URL is missing", "SUPABASE_PUBLISHABLE_KEY is missing"],
    });
  });

  it("names every missing required variable of the worker", () => {
    expect(checkEnv("worker", { SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x" })).toEqual({
      ok: false,
      problems: ["SUPABASE_URL is missing", "SUPABASE_SECRET_KEY is missing"],
    });
  });

  it("treats an empty or blank value as missing", () => {
    expect(checkEnv("web", { SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "   " })).toEqual({
      ok: false,
      problems: ["SUPABASE_URL is empty", "SUPABASE_PUBLISHABLE_KEY is empty"],
    });
  });

  it.each(["not a url", "ftp://project.supabase.co", "project.supabase.co"])("refuses %j as the URL", (url) => {
    expect(checkEnv("web", { ...web, SUPABASE_URL: url })).toEqual({
      ok: false,
      problems: ["SUPABASE_URL is not an http(s) URL"],
    });
  });

  it("accepts a local http URL", () => {
    expect(checkEnv("web", { ...web, SUPABASE_URL: "http://127.0.0.1:54321" }).ok).toBe(true);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    expect(checkEnv("web")).toMatchObject({ ok: false });
    vi.stubEnv("SUPABASE_URL", web.SUPABASE_URL);
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", web.SUPABASE_PUBLISHABLE_KEY);
    expect(checkEnv("web")).toEqual({ ok: true });
  });

  it("requires exactly the variables each process cannot start without", () => {
    expect(Object.keys(webRequiredSchema.shape)).toEqual(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]);
    expect(Object.keys(workerRequiredSchema.shape)).toEqual(["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
  });

  it("never puts a value in a problem or in the message", () => {
    const secret = "sb_secret_DO_NOT_PRINT_ME";
    const result = checkEnv("web", { SUPABASE_URL: secret, SUPABASE_PUBLISHABLE_KEY: "" });
    if (result.ok) throw new Error("expected a failure");
    const message = formatEnvFailure("web", result.problems);
    expect(message).not.toContain(secret);
    expect(message).toContain("SUPABASE_URL is not an http(s) URL");
    expect(message).toContain("SUPABASE_PUBLISHABLE_KEY is empty");
  });
});

describe("formatEnvFailure", () => {
  it("says which process stopped and lists the variables", () => {
    expect(formatEnvFailure("web", ["SUPABASE_URL is missing"])).toBe(
      [
        "Cannot start the web app: required environment variables are missing or invalid.",
        "  - SUPABASE_URL is missing",
        "Set them in the container's env file (see .env.example) and start again. Values are never printed.",
      ].join("\n"),
    );
    expect(formatEnvFailure("worker", ["X is missing"])).toContain("Cannot start the worker");
  });
});

describe("optionalFeaturesOff", () => {
  it("says nothing is off when everything is set", () => {
    expect(
      optionalFeaturesOff({
        ...web,
        SUPABASE_SECRET_KEY: "k",
        SITE_URL: "https://app.example.test",
        PRICE_SERVICE_URL: "http://prices.test",
        VAPID_PUBLIC_KEY: "p",
        AI_PROVIDER: "openai",
        OPENAI_API_KEY: "k",
        AI_MODEL_STATEMENTS: "gpt-5.6-luna",
        FAMILY_ENABLED: "true",
      }),
    ).toEqual([]);
  });

  it("names each optional feature that is off and the variables it needs, with no values", () => {
    const off = optionalFeaturesOff({ ...web, AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-secret-value" });
    expect(off).toEqual([
      "kid accounts, username sign-in, profile pictures and AI budgets (SUPABASE_SECRET_KEY)",
      "a fixed site address for links and MCP (SITE_URL)",
      "investment prices (PRICE_SERVICE_URL)",
      "browser notifications (VAPID_PUBLIC_KEY)",
      "AI (AI_MODEL_STATEMENTS)",
      "the family module (FAMILY_ENABLED is not true)",
    ]);
    expect(off.join(" ")).not.toContain("sk-secret-value");
  });
});

describe("parseServerEnv", () => {
  it("never fails: an empty environment gives the defaults the config modules always used", () => {
    expect(parseServerEnv({})).toEqual({
      SUPABASE_URL: undefined,
      SUPABASE_PUBLISHABLE_KEY: undefined,
      SUPABASE_SECRET_KEY: undefined,
      SITE_URL: undefined,
      TRUSTED_PROXY_HOPS: 1,
      PRICE_SERVICE_URL: undefined,
      FAMILY_ENABLED: false,
      VAPID_PUBLIC_KEY: undefined,
      VAPID_PRIVATE_KEY: undefined,
      VAPID_SUBJECT: undefined,
      AI_PROVIDER: undefined,
      OPENAI_API_KEY: undefined,
      AI_MODEL_STATEMENTS: undefined,
      AI_FAMILY_MONTHLY_USD: 3,
      AI_MONTHLY_BUDGET_USD: 10,
      APP_ADMIN_USER_IDS: [],
      LOG_LEVEL: "info",
      GIT_SHA: undefined,
    });
  });

  it("trims text and treats empty as unset", () => {
    const env = parseServerEnv({ VAPID_PUBLIC_KEY: "  key  ", VAPID_SUBJECT: "", SITE_URL: "   " });
    expect(env.VAPID_PUBLIC_KEY).toBe("key");
    expect(env.VAPID_SUBJECT).toBeUndefined();
    expect(env.SITE_URL).toBeUndefined();
  });

  it("reads LOG_LEVEL as one of the four levels in any case and falls back to info", () => {
    expect(parseServerEnv({ LOG_LEVEL: "debug" }).LOG_LEVEL).toBe("debug");
    expect(parseServerEnv({ LOG_LEVEL: " WARN " }).LOG_LEVEL).toBe("warn");
    expect(parseServerEnv({ LOG_LEVEL: "error" }).LOG_LEVEL).toBe("error");
    for (const bad of ["", "   ", "verbose", "trace", "10"]) {
      expect(parseServerEnv({ LOG_LEVEL: bad }).LOG_LEVEL, bad).toBe("info");
    }
  });

  it("reads TRUSTED_PROXY_HOPS as a whole number from 0 to 5 and falls back to one hop", () => {
    expect(parseServerEnv({ TRUSTED_PROXY_HOPS: "2" }).TRUSTED_PROXY_HOPS).toBe(2);
    expect(parseServerEnv({ TRUSTED_PROXY_HOPS: " 0 " }).TRUSTED_PROXY_HOPS).toBe(0);
    for (const bad of ["", "  ", "-1", "1.5", "many", "6", "1e1"]) {
      expect(parseServerEnv({ TRUSTED_PROXY_HOPS: bad }).TRUSTED_PROXY_HOPS, bad).toBe(1);
    }
  });

  it("turns the family module on only for exactly true", () => {
    expect(parseServerEnv({ FAMILY_ENABLED: "true" }).FAMILY_ENABLED).toBe(true);
    for (const value of ["", "TRUE", "1", "yes", " true", "false"]) {
      expect(parseServerEnv({ FAMILY_ENABLED: value }).FAMILY_ENABLED).toBe(false);
    }
  });

  it("reads AI budgets in dollars and falls back for anything that isn't zero or more", () => {
    expect(parseServerEnv({ AI_FAMILY_MONTHLY_USD: "5", AI_MONTHLY_BUDGET_USD: " 25.5 " })).toMatchObject({
      AI_FAMILY_MONTHLY_USD: 5,
      AI_MONTHLY_BUDGET_USD: 25.5,
    });
    expect(parseServerEnv({ AI_FAMILY_MONTHLY_USD: "0" }).AI_FAMILY_MONTHLY_USD).toBe(0);
    for (const value of ["", "  ", "abc", "-1", "NaN", "Infinity"]) {
      expect(parseServerEnv({ AI_FAMILY_MONTHLY_USD: value, AI_MONTHLY_BUDGET_USD: value })).toMatchObject({
        AI_FAMILY_MONTHLY_USD: 3,
        AI_MONTHLY_BUDGET_USD: 10,
      });
    }
  });

  it("keeps only valid admin user ids, lower-cased and without duplicates", () => {
    const env = parseServerEnv({ APP_ADMIN_USER_IDS: ` ${ADMIN.toUpperCase()}, not-an-id,${ADMIN},, ` });
    expect(env.APP_ADMIN_USER_IDS).toEqual([ADMIN]);
  });

  it("reads process.env on every getEnv call, so a stub is seen at once", () => {
    vi.stubEnv("FAMILY_ENABLED", "true");
    expect(getEnv().FAMILY_ENABLED).toBe(true);
    vi.stubEnv("FAMILY_ENABLED", "false");
    expect(getEnv().FAMILY_ENABLED).toBe(false);
  });

  it("gives the AI variables by name", () => {
    expect(getAiEnv({ AI_PROVIDER: " openai ", OPENAI_API_KEY: " k ", AI_MODEL_STATEMENTS: "m", SITE_URL: "x" })).toEqual({
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "k",
      AI_MODEL_STATEMENTS: "m",
    });
  });
});
