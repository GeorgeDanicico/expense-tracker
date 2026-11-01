#!/usr/bin/env node
// Fails when the production dependencies have a high or critical advisory that isn't allowlisted.
//
//   node scripts/audit-check.mjs              run `npm audit --omit=dev --json` and judge it
//   node scripts/audit-check.mjs --self-test  prove the judging logic on fake reports, no network
//
// Why a script and not `npm audit --audit-level=high` alone: npm has no way to accept one known
// advisory, so one unfixable finding would force the whole check off. audit-allowlist.json lists
// the advisories we accept for now. Each entry needs:
//   "id"       the GitHub advisory id (GHSA-xxxx-xxxx-xxxx) from the audit output
//   "reason"   why it is safe to wait (not reachable, no fix yet, mitigated by ...)
//   "expires"  YYYY-MM-DD, at most 90 days out; after that date the check fails again
// An entry that no longer matches any finding is reported as stale so it can be deleted.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FAIL_AT = new Set(["high", "critical"]);
const MAX_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

// Every advisory in the report is a `via` object on some package; strings only point at another package.
export function collectAdvisories(report) {
  const found = new Map();
  for (const [name, entry] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of entry.via ?? []) {
      if (typeof via === "string") continue;
      const ghsa = /GHSA-[a-z0-9-]+/i.exec(via.url ?? "")?.[0] ?? `npm-advisory-${via.source}`;
      const advisory = found.get(ghsa) ?? {
        id: ghsa,
        severity: via.severity,
        title: via.title,
        range: via.range,
        packages: new Set(),
      };
      advisory.packages.add(via.name ?? name);
      found.set(ghsa, advisory);
    }
  }
  return [...found.values()];
}

export function evaluate(report, allowlist, today = new Date()) {
  const problems = [];
  const accepted = [];
  const notes = [];
  const byId = new Map();

  for (const entry of allowlist) {
    const where = `allowlist entry ${entry.id ?? "(no id)"}`;
    const expires = Date.parse(`${entry.expires}T23:59:59Z`);
    if (!entry.id || !entry.reason || Number.isNaN(expires)) {
      problems.push(`${where} needs an id, a reason and an expires date (YYYY-MM-DD).`);
      continue;
    }
    if (expires - today.getTime() > MAX_DAYS * DAY_MS) {
      problems.push(`${where} expires more than ${MAX_DAYS} days from now (${entry.expires}).`);
    }
    byId.set(entry.id.toUpperCase(), { ...entry, expiresAt: expires });
  }

  const seen = new Set();
  for (const advisory of collectAdvisories(report)) {
    if (!FAIL_AT.has(advisory.severity)) continue;
    const label = `${advisory.id} (${advisory.severity}) in ${[...advisory.packages].join(", ")}: ${advisory.title}`;
    const entry = byId.get(advisory.id.toUpperCase());
    seen.add(advisory.id.toUpperCase());
    if (!entry) problems.push(`Not allowlisted: ${label}`);
    else if (entry.expiresAt < today.getTime()) problems.push(`Allowlist entry expired on ${entry.expires}: ${label}`);
    else accepted.push(`Allowlisted until ${entry.expires} (${entry.reason}): ${label}`);
  }
  for (const id of byId.keys()) {
    if (!seen.has(id)) notes.push(`Stale allowlist entry, no longer reported, delete it: ${id}`);
  }
  return { problems, accepted, notes };
}

function selfTest() {
  const report = {
    vulnerabilities: {
      next: {
        via: [
          { source: 1, name: "next", severity: "critical", title: "RCE", url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" },
          { source: 2, name: "next", severity: "moderate", title: "minor", url: "https://github.com/advisories/GHSA-mmmm-mmmm-mmmm" },
        ],
      },
      "some-dependent": { via: ["next"] },
    },
  };
  const now = new Date("2026-01-01T00:00:00Z");
  const entry = (extra) => ({ id: "GHSA-aaaa-bbbb-cccc", reason: "test", expires: "2026-02-01", ...extra });
  const checks = [
    ["a high or critical finding fails", evaluate(report, [], now).problems.length === 1],
    ["a moderate finding is ignored", !evaluate(report, [entry()], now).problems.length && evaluate(report, [], now).problems.every((p) => !p.includes("mmmm"))],
    ["an allowlisted finding passes", evaluate(report, [entry()], now).problems.length === 0],
    ["an expired entry fails", evaluate(report, [entry({ expires: "2025-12-31" })], now).problems.length === 1],
    ["an entry too far out fails", evaluate(report, [entry({ expires: "2027-01-01" })], now).problems.length === 1],
    ["an entry without a reason fails", evaluate(report, [entry({ reason: "" })], now).problems.length >= 1],
    ["a stale entry is reported", evaluate({ vulnerabilities: {} }, [entry()], now).notes.length === 1],
    ["a clean report passes", evaluate({ vulnerabilities: {} }, [], now).problems.length === 0],
  ];
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) failed += 1;
  }
  process.exit(failed ? 1 : 0);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  const allowlist = JSON.parse(readFileSync(new URL("../audit-allowlist.json", import.meta.url), "utf8"));
  // npm exits non-zero when it finds anything; the JSON on stdout is what counts. No JSON means npm
  // itself failed (registry down, bad lockfile), and that must not pass quietly.
  const result = spawnSync("npm", ["audit", "--omit=dev", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    console.error(`npm audit gave no JSON report (exit ${result.status}).\n${result.stderr}`);
    process.exit(2);
  }
  if (report.error) {
    console.error(`npm audit failed: ${report.error.summary ?? JSON.stringify(report.error)}`);
    process.exit(2);
  }

  const { problems, accepted, notes } = evaluate(report, allowlist);
  for (const line of accepted) console.log(`::warning::${line}`);
  for (const line of notes) console.log(`::warning::${line}`);
  for (const line of problems) console.error(`::error::${line}`);
  const counts = report.metadata?.vulnerabilities ?? {};
  console.log(`Production dependencies: ${counts.critical ?? 0} critical, ${counts.high ?? 0} high, ${counts.moderate ?? 0} moderate, ${counts.low ?? 0} low.`);
  if (problems.length) {
    console.error(`${problems.length} problem(s). Update the dependency, or allowlist the advisory with a reason and an expiry in audit-allowlist.json.`);
    process.exit(1);
  }
  console.log("Dependency audit passed.");
}

main();
