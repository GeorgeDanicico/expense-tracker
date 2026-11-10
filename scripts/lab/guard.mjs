#!/usr/bin/env node
// The lab's safety check (docs/lab.md): the lab only ever talks to addresses on this machine.
//
//   node scripts/lab/guard.mjs <env file>      exit 0 when it's safe, else print why and exit 1
//
// scripts/lab.sh runs it before it starts anything that reads the env file (the app, the seed, the
// measuring script), so a lab env file that points at a hosted Supabase project, by mistake or by
// copy and paste from .env.local, stops the lab before a single request is sent.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The variables that must be set. SUPABASE_URL is the one that matters. */
export const REQUIRED_VARIABLES = ["SUPABASE_URL", "SITE_URL"];

/**
 * Why `value` isn't a loopback http(s) address, or null when it is. Loopback means `localhost`,
 * a `*.localhost` name, 127.0.0.0/8 or `::1`: names that never leave this machine. Anything else
 * (a hosted project, a LAN address, `0.0.0.0`, a name that merely contains "localhost") is refused.
 */
export function loopbackProblem(value) {
  if (typeof value !== "string" || value.trim() === "") return "is not set";
  let url;
  try {
    url = new URL(value);
  } catch {
    return "is not a URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return `uses ${url.protocol}, not http or https`;
  if (url.username || url.password) return "carries a user name or password";
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return null;
  if (host === "[::1]") return null;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) && host.split(".").every((part) => Number(part) <= 255)) return null;
  return `points at ${host}, which is not this machine (only localhost, 127.x.x.x and ::1 are allowed)`;
}

/** `KEY=value` lines to an object. Blank lines and `#` comments are skipped; values are taken as written. */
export function parseEnvFile(text) {
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const equals = trimmed.indexOf("=");
    if (equals <= 0) continue;
    env[trimmed.slice(0, equals).trim()] = trimmed.slice(equals + 1).trim();
  }
  return env;
}

/**
 * Every problem with the env, as `NAME problem` lines. Empty when the env is safe for the lab:
 * SUPABASE_URL and SITE_URL are set, and every `*_URL` variable (the lab's own direct address
 * included, or a price-service URL pasted in by mistake) is on this machine.
 */
export function guardProblems(env) {
  const names = [...new Set([...REQUIRED_VARIABLES, ...Object.keys(env).filter((name) => name.endsWith("_URL"))])];
  return names.flatMap((name) => {
    const problem = loopbackProblem(env[name]);
    return problem === null ? [] : [`${name} ${problem}`];
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/lab/guard.mjs <env file>");
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    console.error(`lab guard: cannot read ${file}`);
    process.exit(1);
  }
  const problems = guardProblems(parseEnvFile(text));
  if (problems.length > 0) {
    // Names and hosts only, never a key.
    for (const problem of problems) console.error(`lab guard: refusing to start: ${problem}`);
    process.exit(1);
  }
}
