#!/usr/bin/env node
// Collects the raw, ungrouped inventory of the app: every source file and what it contains
// (pages, API routes, Supabase calls, MCP tools, worker jobs, env names, tests) plus the final
// database schema replayed from supabase/migrations. No feature grouping happens here; that is
// group.mjs, driven by features.json.
//
//   node .claude/skills/feature-map/scripts/collect.mjs [--out <file>]
//
// Without --out it prints the JSON to stdout.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { classify, findReferences, functionId, splitStatements } from "./lib/sql.mjs";
import { loadTypeScript, scanSource } from "./lib/ts-scan.mjs";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = resolve(SKILL_DIR, "../../..");

const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".mjs", ".js", ".jsx"];

export const CACHE_DIR = join(SKILL_DIR, ".cache");

/**
 * Exact test-case counts per file from `vitest list --json` (it expands it.each tables and tests
 * built in loops, which a static count can't). Returns null when Vitest can't run.
 */
function vitestCounts() {
  const bin = join(ROOT, "node_modules", ".bin", "vitest");
  if (!existsSync(bin)) return null;
  mkdirSync(CACHE_DIR, { recursive: true });
  const out = join(CACHE_DIR, "vitest-list.json");
  const run = spawnSync(bin, ["list", `--json=${out}`], { cwd: ROOT, stdio: ["ignore", "ignore", "pipe"], encoding: "utf8", timeout: 300_000 });
  if (run.status !== 0 || !existsSync(out)) {
    console.error(`vitest list failed (${run.status ?? run.signal}); using static test counts.${run.stderr ? `\n${run.stderr.slice(-500)}` : ""}`);
    return null;
  }
  const counts = new Map();
  for (const test of JSON.parse(readFileSync(out, "utf8"))) {
    const path = relative(ROOT, test.file).split("\\").join("/");
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

export function loadConfig() {
  return JSON.parse(readFileSync(join(SKILL_DIR, "features.json"), "utf8"));
}

function walk(dir, config, out = []) {
  const absolute = join(ROOT, dir);
  if (!existsSync(absolute)) return out;
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const path = posix.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (config.scan.skipDirectories.includes(entry.name)) continue;
      walk(path, config, out);
    } else if (config.scan.extensions.some((extension) => entry.name.endsWith(extension))) {
      out.push(path);
    }
  }
  return out;
}

const isTest = (path) => /\.test\.[cm]?[jt]sx?$/.test(path);

function testKind(path) {
  if (path.startsWith("supabase/tests/")) return "db";
  if (path.startsWith("src/app/")) return path.endsWith(".tsx") ? "page" : "route";
  if (path.endsWith(".tsx")) return "component";
  return "unit";
}

function fileKind(path) {
  if (path.startsWith("supabase/migrations/")) return "migration";
  if (path.startsWith("supabase/tests/support/")) return "sql-test-support";
  if (path.startsWith("supabase/tests/")) return "sql-test";
  if (path.startsWith("supabase/")) return "sql-script";
  if (path.startsWith("public/")) return "static";
  if (isTest(path)) return "test";
  if (path.startsWith("src/app/")) {
    const base = posix.basename(path);
    if (/^page\.[jt]sx?$/.test(base)) return "page";
    if (/^route\.[jt]s$/.test(base)) return "route";
    if (/^(layout|template|error|loading|not-found|global-error)\.[jt]sx?$/.test(base)) return "layout";
    return "app";
  }
  if (path.startsWith("src/components/")) return "component";
  if (path.startsWith("src/hooks/")) return "hook";
  if (path.startsWith("src/worker/")) return "worker";
  if (path.startsWith("src/test/")) return "test-support";
  if (path.startsWith("src/lib/")) return "lib";
  if (/^src\/(proxy|middleware)\.ts$/.test(path)) return "proxy";
  return "other";
}

function libRole(path, scan) {
  const base = posix.basename(path).replace(/\.[jt]sx?$/, "");
  if (path.startsWith("src/lib/supabase/repositories/")) return "repository (Supabase)";
  if (path.startsWith("src/lib/validation/")) return "validation";
  if (path.startsWith("src/lib/mcp/tools/")) return "mcp tools";
  if (base === "service" || base.endsWith("-service")) return "service";
  if (base === "repository" || base.endsWith("-repository") || base.endsWith("-store")) return "repository";
  if (base === "types") return "types";
  if (scan?.imports.some((imp) => imp.spec === "zod") && /schema/i.test(scan.exports.join(" "))) return "validation";
  return "logic";
}

function resolveImport(from, spec, known) {
  let base;
  if (spec.startsWith("@/")) base = posix.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), spec));
  else return null;
  const candidates = [base, ...CODE_EXTENSIONS.map((ext) => base + ext), ...CODE_EXTENSIONS.map((ext) => `${base}/index${ext}`)];
  return candidates.find((candidate) => known.has(candidate)) ?? null;
}

/** `src/app/(app)/settings/mcp/page.tsx` → `{ route: "/settings/mcp", group: "(app)" }`. */
function appRoute(path) {
  const segments = path.replace(/^src\/app\/?/, "").split("/").slice(0, -1);
  const groups = segments.filter((segment) => /^\(.+\)$/.test(segment));
  const route = `/${segments.filter((segment) => !/^\(.+\)$/.test(segment)).join("/")}`;
  return { route, group: groups[0] ?? "(none)" };
}

/** A route pattern (`/api/todos/[id]/move`) as a RegExp, and how many dynamic segments it has. */
function routeMatcher(route) {
  let dynamic = 0;
  const source = route
    .split("/")
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) {
        dynamic += 2;
        return "(?:/.*)?";
      }
      if (/^\[\.\.\..+\]$/.test(segment)) {
        dynamic += 2;
        return "/.+";
      }
      if (/^\[.+\]$/.test(segment)) {
        dynamic += 1;
        return "/[^/]+";
      }
      return segment ? `/${segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` : "";
    })
    .join("");
  return { regExp: new RegExp(`^${source}/?$`), dynamic };
}

/** `/api/imports/*\/undo` (a literal with `${…}` as `*`) as a concrete sample path. */
function samplePath(literal) {
  return literal.replace(/([^/])\*$/, "$1").replace(/\*/g, "x1").replace(/\.ics$/, "");
}

function readNav(config) {
  const items = [];
  for (const file of config.nav.files) {
    const text = readFileSync(join(ROOT, file), "utf8");
    const pattern = /(?:(\w+):\s*)?\{\s*href:\s*"([^"]+)",\s*label:\s*"([^"]+)"([^}]*)\}/g;
    let m;
    while ((m = pattern.exec(text))) {
      const extra = m[4];
      items.push({
        key: m[1] ?? null,
        href: m[2],
        label: m[3],
        module: /module:\s*"([^"]+)"/.exec(extra)?.[1] ?? null,
        requiresFamily: /requiresFamily:\s*true/.test(extra),
        badge: /badge:\s*"([^"]+)"/.exec(extra)?.[1] ?? null,
        source: file,
        place: m[2].startsWith("/settings") ? "settings tabs" : "main navigation",
      });
    }
    // Main-navigation sections: `{ label: "Finance", items: [NAV_ITEMS.expenses, …] }`.
    const sections = /\{\s*label:\s*"([^"]+)",\s*items:\s*\[([^\]]*)\]\s*\}/g;
    while ((m = sections.exec(text))) {
      for (const key of [...m[2].matchAll(/NAV_ITEMS\.(\w+)/g)].map((x) => x[1])) {
        const item = items.find((entry) => entry.key === key && entry.source === file);
        if (item) item.section = m[1];
      }
    }
    const tabBar = /TAB_BAR_ITEMS[^=]*=\s*\[([^\]]*)\]/.exec(text);
    if (tabBar) {
      for (const key of [...tabBar[1].matchAll(/NAV_ITEMS\.(\w+)/g)].map((x) => x[1])) {
        const item = items.find((entry) => entry.key === key && entry.source === file);
        if (item) item.mobileTabBar = true;
      }
    }
  }
  // One entry per href (settings-nav declares some tabs twice: as constants and inline).
  return [...new Map(items.map((item) => [item.href, item])).values()];
}

function readEnvExample(config) {
  const file = join(ROOT, config.env.example);
  if (!existsSync(file)) return [];
  return [...readFileSync(file, "utf8").matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
}

function sqlComment(text) {
  const lines = [];
  for (const line of text.split("\n")) {
    const m = /^\s*--\s?(.*)$/.exec(line);
    if (m) {
      if (m[1].trim() || lines.length) lines.push(m[1].trim());
      if (!m[1].trim() && lines.length) break;
    } else if (line.trim() && !/^(begin|create extension|select plan|set )/i.test(line.trim())) {
      if (lines.length) break;
    }
  }
  const plain = lines.join(" ").trim();
  const sentence = /^(.+?[.!?])(?:\s|$)/.exec(plain)?.[1] ?? plain;
  return sentence.length > 180 ? `${sentence.slice(0, 177)}…` : sentence || null;
}

/**
 * DDL inside `do $$ … $$` blocks (guarded creates such as `if to_regclass(…) is null then create
 * table …`) becomes ordinary statements, with the surrounding control flow stripped.
 */
function expandDoBlocks(statements) {
  const out = [];
  for (const statement of statements) {
    const body = /^do\s+(\$[A-Za-z_]*\$)([\s\S]*)\1/i.exec(statement.clean);
    if (!body) {
      out.push(statement);
      continue;
    }
    for (const inner of splitStatements(body[2])) {
      const clean = inner.clean
        .replace(/^(?:declare\b[\s\S]*?\bbegin\b|begin\b)\s*/i, "")
        .replace(/^(?:(?:if|elsif)\b[\s\S]*?\bthen\b\s*|else\b\s*|end\s+if\b\s*;?\s*)+/i, "");
      if (clean) out.push({ ...inner, clean, line: statement.line + inner.line - 1 });
    }
  }
  return out;
}

function replayMigrations(paths, externalSchemas) {
  const tables = new Map();
  const functions = new Map();
  const buckets = new Map();
  const schemas = new Set();
  const migrations = [];

  const table = (id, migration) => {
    if (!tables.has(id)) tables.set(id, { id, createdIn: null, migrations: [], rls: false, comment: null, policies: new Map(), triggers: new Map(), indexes: new Set() });
    const entry = tables.get(id);
    if (migration && !entry.migrations.includes(migration)) entry.migrations.push(migration);
    return entry;
  };

  for (const { path, legacy } of paths) {
    const statements = expandDoBlocks(splitStatements(readFileSync(join(ROOT, path), "utf8")));
    const summary = { path, legacy, statements: statements.length, creates: [] };
    migrations.push(summary);
    for (const statement of statements) {
      const s = classify(statement);
      if (!s) continue;
      const at = `${path}:${statement.line}`;
      switch (s.type) {
        case "create_table":
        case "create_view": {
          const entry = table(s.table, path);
          entry.createdIn ??= at;
          if (legacy) entry.legacy = true;
          if (s.type === "create_view") entry.view = true;
          summary.creates.push(`${s.type === "create_view" ? "view" : "table"} ${s.table}`);
          break;
        }
        case "drop_table":
          for (const id of s.tables) tables.delete(id);
          break;
        case "rename_table": {
          const entry = tables.get(s.from);
          if (entry) {
            tables.delete(s.from);
            entry.id = s.to;
            entry.renamedFrom = s.from;
            tables.set(s.to, entry);
          }
          break;
        }
        case "alter_table": {
          if (s.table.startsWith("storage.")) break;
          const entry = table(s.table, path);
          if (s.enablesRls) entry.rls = true;
          if (s.forcesRls) entry.forceRls = true;
          break;
        }
        case "create_function": {
          const existing = functions.get(s.fn);
          functions.set(s.fn, {
            id: s.fn,
            legacy: existing?.legacy ?? legacy,
            createdIn: existing?.createdIn ?? at,
            migrations: [...new Set([...(existing?.migrations ?? []), path])],
            securityDefiner: s.securityDefiner,
            returnsTrigger: s.returnsTrigger,
            language: s.language,
            comment: existing?.comment ?? null,
            body: s.body,
          });
          if (!existing) summary.creates.push(`function ${s.fn}`);
          break;
        }
        case "drop_function":
          functions.delete(s.fn);
          break;
        case "create_policy": {
          const entry = table(s.table, s.table.startsWith("storage.") ? null : path);
          if (s.table.startsWith("storage.")) entry.external = true;
          entry.policies.set(s.policy, { name: s.policy, table: s.table, command: s.command, roles: s.roles, definedIn: at, body: s.body });
          summary.creates.push(`policy ${s.policy} on ${s.table}`);
          break;
        }
        case "drop_policy":
          tables.get(s.table)?.policies.delete(s.policy);
          break;
        case "rename_policy": {
          const policies = tables.get(s.table)?.policies;
          const policy = policies?.get(s.policy);
          if (policy) {
            policies.delete(s.policy);
            policies.set(s.to, { ...policy, name: s.to });
          }
          break;
        }
        case "create_trigger":
          table(s.table, path).triggers.set(s.trigger, { name: s.trigger, table: s.table, fn: s.fn, timing: s.timing, events: s.events, definedIn: at });
          break;
        case "drop_trigger":
          tables.get(s.table)?.triggers.delete(s.trigger);
          break;
        case "create_index":
          table(s.table, path).indexes.add(s.index || `(unnamed)@${at}`);
          break;
        case "drop_index":
          for (const entry of tables.values()) entry.indexes.delete(s.index);
          break;
        case "create_schema":
          schemas.add(s.schema);
          break;
        case "create_bucket":
          buckets.set(s.bucket, { id: s.bucket, createdIn: at });
          break;
        case "comment":
          if (s.kind === "function" && functions.has(s.id)) functions.get(s.id).comment = s.text;
          if ((s.kind === "table" || s.kind === "view") && tables.has(s.id)) tables.get(s.id).comment = s.text;
          break;
        default:
          break;
      }
    }
  }

  // Supabase's own schemas (auth, storage) aren't the app's: their tables and functions are kept,
  // flagged external, but never counted as references.
  const external = (id) => externalSchemas.includes(id.split(".")[0]) && id.includes(".");
  for (const entry of tables.values()) if (external(entry.id)) entry.external = true;
  const tableIds = [...tables.keys()].filter((id) => !tables.get(id).external);
  const functionIds = [...functions.keys()].filter((id) => !external(id));
  const refs = (text, self) => {
    const found = findReferences(text, tableIds, functionIds.filter((id) => id !== self));
    return { tables: [...found.tables].sort(), functions: [...found.functions].sort() };
  };

  const firstSentence = (text) => {
    if (!text) return null;
    const plain = text.replace(/\s+/g, " ").trim();
    return /^(.+?[.!?])(?:\s|$)/.exec(plain)?.[1] ?? plain;
  };

  return {
    schemas: [...schemas].sort(),
    migrations,
    buckets: [...buckets.values()],
    tables: [...tables.values()].map((entry) => ({
      id: entry.id,
      legacy: !!entry.legacy,
      external: !!entry.external,
      view: !!entry.view,
      createdIn: entry.createdIn,
      renamedFrom: entry.renamedFrom ?? null,
      migrations: entry.migrations.filter((path) => path.startsWith("supabase/migrations/")),
      rls: entry.rls,
      comment: firstSentence(entry.comment),
      indexes: entry.indexes.size,
      policies: [...entry.policies.values()].map(({ body, ...policy }) => ({ ...policy, references: refs(body) })),
      triggers: [...entry.triggers.values()],
    })),
    functions: [...functions.values()].map(({ body, comment, ...fn }) => ({
      ...fn,
      external: external(fn.id),
      migrations: fn.migrations.filter((path) => path.startsWith("supabase/migrations/")),
      comment: firstSentence(comment),
      references: refs(body, fn.id),
    })),
  };
}

export function collect(config = loadConfig(), { vitest = true } = {}) {
  loadTypeScript(ROOT);
  const exactCounts = vitest ? vitestCounts() : null;
  const files = config.scan.roots.flatMap((dir) => walk(dir, config)).sort();
  const known = new Set(files);

  const inventory = {
    generatedAt: new Date().toISOString(),
    root: ROOT,
    files: [],
    pages: [],
    apiRoutes: [],
    nav: readNav(config),
    flags: [],
    envVars: [],
    mcpTools: [],
    workerJobs: [],
    testCountSource: exactCounts ? "vitest list" : "static",
    sql: null,
    sqlTests: [],
  };

  const scans = new Map();
  for (const path of files) {
    const text = readFileSync(join(ROOT, path), "utf8");
    const kind = fileKind(path);
    const record = { path, kind, lines: text.split("\n").length };
    if (CODE_EXTENSIONS.some((ext) => path.endsWith(ext))) {
      const scan = scanSource(path, text);
      scans.set(path, scan);
      record.description = scan.description;
      record.useClient = scan.useClient;
      record.imports = [...new Set(scan.imports.map((imp) => resolveImport(path, imp.spec, known)).filter(Boolean))];
      record.typeOnlyImports = [...new Set(scan.imports.filter((imp) => imp.typeOnly).map((imp) => resolveImport(path, imp.spec, known)).filter(Boolean))];
      record.packages = [...new Set(scan.imports.map((imp) => imp.spec).filter((spec) => !spec.startsWith(".") && !spec.startsWith("@/")))].sort();
      record.importedNames = Object.fromEntries(
        scan.imports.map((imp) => [resolveImport(path, imp.spec, known) ?? imp.spec, imp.names]).filter(([, names]) => names.length),
      );
      record.rpcs = scan.rpcs;
      record.tables = scan.tables;
      record.buckets = scan.buckets;
      record.apiPaths = scan.apiPaths;
      record.definedApi = scan.definedApi;
      record.exports = scan.exports;
      if (kind === "lib") record.role = libRole(path, scan);
      if (kind === "test") {
        record.testKind = testKind(path);
        record.testCases = exactCounts?.get(path) ?? scan.testCases;
        record.testCount = exactCounts ? (exactCounts.has(path) ? "vitest" : "not run by vitest") : "static";
        if (exactCounts && !exactCounts.has(path)) record.testCases = 0;
      }
    }
    if (kind === "test" && !record.testKind) record.testKind = testKind(path);
    inventory.files.push(record);
  }

  // Pages and API routes.
  for (const record of inventory.files) {
    const scan = scans.get(record.path);
    if (record.kind === "page") {
      const { route, group } = appRoute(record.path);
      inventory.pages.push({
        route,
        group,
        file: record.path,
        nav: inventory.nav.find((item) => item.href === route) ?? null,
        permissionGate: scan.jsxGates.map((gate) => gate.module).filter(Boolean),
        devOnly: /NODE_ENV\s*===\s*"production"\)\s*notFound/.test(readFileSync(join(ROOT, record.path), "utf8")),
        client: scan.useClient,
      });
    }
    if (record.kind === "route") {
      const { route } = appRoute(record.path);
      const guards = scan.calledIdentifiers.filter((name) => config.routes.guardCalls.includes(name));
      inventory.apiRoutes.push({
        route,
        file: record.path,
        api: route.startsWith("/api/"),
        runtime: scan.runtime,
        guards,
        methods: scan.routeMethods.map((method) => {
          const wrapper = method.wrapper;
          let auth = "none (handles its own access)";
          let permission = null;
          if (wrapper?.callee === "withUser") auth = "withUser";
          else if (wrapper?.callee === "withPermission") {
            auth = "withPermission";
            permission = { module: wrapper.args[0] ?? null, level: wrapper.args[1] ?? null };
          } else if (wrapper) auth = wrapper.callee;
          return { method: method.method, auth, permission };
        }).sort((a, b) => a.method.localeCompare(b.method)),
        calledFrom: [],
      });
    }
  }
  const matchers = inventory.apiRoutes.map((route) => ({ route, ...routeMatcher(route.route) }));
  for (const record of inventory.files) {
    if (record.kind === "test" || record.kind === "test-support" || !record.apiPaths) continue;
    // Paths this file uses directly, plus those of the URL constants and helpers it imports.
    const used = new Set(record.apiPaths);
    for (const [target, names] of Object.entries(record.importedNames ?? {})) {
      const defined = scans.get(target)?.definedApi ?? {};
      for (const name of names) for (const path of defined[name] ?? []) used.add(path);
    }
    record.apiPaths = [...used].sort();
    for (const literal of record.apiPaths) {
      const sample = samplePath(literal);
      const match = matchers.filter((m) => m.regExp.test(sample)).sort((a, b) => a.dynamic - b.dynamic)[0];
      if (match && !match.route.calledFrom.includes(record.path)) match.route.calledFrom.push(record.path);
    }
  }

  // Feature flags: exported functions of the flags file, the env var each reads, and the guards
  // (exported functions elsewhere that call a flag function).
  const flagsFile = config.flags.file;
  if (known.has(flagsFile)) {
    const text = readFileSync(join(ROOT, flagsFile), "utf8");
    for (const fn of scans.get(flagsFile).functions.filter((f) => f.exported)) {
      const body = new RegExp(String.raw`function ${fn.name}\b[\s\S]*?\n\}`).exec(text)?.[0] ?? "";
      inventory.flags.push({
        name: fn.name,
        env: [...body.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]),
        description: fn.description,
        file: flagsFile,
        guards: [],
        usedIn: [],
      });
    }
    for (const flag of inventory.flags) {
      for (const [path, scan] of scans) {
        const names = Object.entries(inventory.files.find((f) => f.path === path).importedNames ?? {});
        if (!names.some(([target, imported]) => target === flagsFile && imported.includes(flag.name))) continue;
        for (const fn of scan.functions) {
          if (fn.exported && fn.localCalls.includes(flag.name) && !isTest(path)) flag.guards.push({ name: fn.name, file: path });
        }
      }
      const watched = [{ name: flag.name, file: flagsFile }, ...flag.guards];
      for (const record of inventory.files) {
        if (!record.importedNames) continue;
        const via = watched.filter((w) => record.importedNames[w.file]?.includes(w.name)).map((w) => w.name);
        if (via.length) flag.usedIn.push({ file: record.path, via });
      }
    }
  }

  // Env vars: names in the env example plus every process.env.X; where each is read (tests excluded).
  const envCandidates = new Set(readEnvExample(config));
  for (const scan of scans.values()) for (const name of scan.envNames) envCandidates.add(name);
  for (const name of [...envCandidates].sort()) {
    const usedIn = [];
    for (const [path, scan] of scans) {
      if (isTest(path)) continue;
      if (scan.envNames.includes(name) || scan.upperStrings.includes(name)) usedIn.push(path);
    }
    const inExample = readEnvExample(config).includes(name);
    inventory.envVars.push({ name, inEnvExample: inExample, public: name.startsWith("NEXT_PUBLIC_"), usedIn });
  }

  // MCP tools, and which tool lists the server registers only behind a flag.
  const serverFile = config.mcp.server;
  const serverText = known.has(serverFile) ? readFileSync(join(ROOT, serverFile), "utf8") : "";
  const gatedLists = new Map();
  for (const flag of inventory.flags) {
    const m = new RegExp(String.raw`${flag.name}\(\)\s*\?\s*\[([^\]]*)\]`).exec(serverText);
    if (m) for (const list of [...m[1].matchAll(/\.\.\.(\w+)/g)].map((x) => x[1])) gatedLists.set(list, flag.name);
  }
  for (const [path, scan] of scans) {
    if (!path.startsWith(config.mcp.toolsDir) || isTest(path)) continue;
    const gatedBy = scan.exports.map((name) => gatedLists.get(name)).find(Boolean) ?? null;
    for (const tool of scan.tools) {
      const access = /READ/.test(tool.annotations ?? "") ? "read" : /DELETE/.test(tool.annotations ?? "") ? "delete" : /CREATE/.test(tool.annotations ?? "") ? "create" : /UPDATE/.test(tool.annotations ?? "") ? "update" : null;
      inventory.mcpTools.push({ name: tool.name, title: tool.title ?? null, module: tool.module ?? null, access, file: path, gatedBy, description: tool.description ?? null });
    }
  }

  // Worker jobs: the local functions the tick calls, each with the store methods it reaches
  // (transitively through other local functions) and the tables/RPCs those methods use.
  const tickFile = config.worker.tickFile;
  const storeFile = config.worker.storeFile;
  if (scans.has(tickFile)) {
    const local = new Map(scans.get(tickFile).functions.map((fn) => [fn.name, fn]));
    const storeMethods = new Map((scans.get(storeFile)?.objectMethods ?? []).map((method) => [method.name, method]));
    const tick = local.get(config.worker.tickFunction);
    const reach = (fn, seen = new Set()) => {
      const methods = new Set();
      if (!fn || seen.has(fn.name)) return methods;
      seen.add(fn.name);
      for (const call of fn.memberCalls) if (call.startsWith("store.")) methods.add(call.slice(6));
      for (const name of fn.localCalls) if (local.has(name) && name !== fn.name) for (const m of reach(local.get(name), seen)) methods.add(m);
      return methods;
    };
    const describe = (name, fn, methods) => {
      const rpcs = new Set();
      const tables = new Set();
      for (const method of methods) {
        for (const rpc of storeMethods.get(method)?.rpcs ?? []) rpcs.add(rpc);
        for (const table of storeMethods.get(method)?.tables ?? []) tables.add(table);
      }
      return { name, file: tickFile, description: fn?.description ?? null, storeMethods: [...methods].sort(), rpcs: [...rpcs].sort(), tables: [...tables].sort() };
    };
    if (tick) {
      const jobs = tick.localCalls.filter((name) => local.has(name) && name !== tick.name);
      for (const name of jobs) {
        const methods = reach(local.get(name));
        if (methods.size) inventory.workerJobs.push(describe(name, local.get(name), methods));
      }
      const direct = new Set(tick.memberCalls.filter((call) => call.startsWith("store.")).map((call) => call.slice(6)));
      if (direct.size) inventory.workerJobs.push({ ...describe(`${tick.name} (itself)`, tick, direct), description: "The tick's own bookkeeping: heartbeat and due counts." });
    }
  }

  // Database: final schema from the migrations, then the pgTAP tests and what they touch.
  // Objects that predate the migrations (created by hand before the repo tracked them) come from
  // the bootstrap script the database tests load first; they are marked `legacy`.
  const migrationFiles = [
    ...(config.sql?.preMigrations ?? []).filter((path) => known.has(path)).map((path) => ({ path, legacy: true })),
    ...files.filter((path) => path.startsWith("supabase/migrations/")).sort().map((path) => ({ path, legacy: false })),
  ];
  inventory.sql = replayMigrations(migrationFiles, config.sql?.externalSchemas ?? ["auth", "storage"]);
  const tableIds = inventory.sql.tables.filter((t) => !t.external).map((t) => t.id);
  const functionIds = inventory.sql.functions.filter((f) => !f.external).map((f) => f.id);
  for (const path of files.filter((p) => p.startsWith("supabase/") && !p.startsWith("supabase/migrations/") && p.endsWith(".sql"))) {
    const text = readFileSync(join(ROOT, path), "utf8");
    const plan = /select\s+(?:\*\s+from\s+)?plan\(\s*(\d+)\s*\)/i.exec(text);
    const assertions = (text.match(/\b(?:ok|is|isnt|results_eq|set_eq|bag_eq|throws_ok|throws_like|lives_ok|is_empty|isnt_empty|policy_cmd_is|has_table|has_function|row_eq|cmp_ok|matches)\s*\(/gi) ?? []).length;
    const found = findReferences(text, tableIds, functionIds);
    inventory.sqlTests.push({
      file: path,
      kind: fileKind(path),
      tests: plan ? Number(plan[1]) : assertions,
      counted: plan ? "plan" : "assertions",
      description: sqlComment(text),
      tables: [...found.tables].sort(),
      functions: [...found.functions].sort(),
    });
  }

  // Code → database: RPC names are public functions.
  for (const record of inventory.files) if (record.rpcs) record.rpcs = record.rpcs.map((rpc) => functionId(rpc));
  return inventory;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inventory = collect(loadConfig(), { vitest: !process.argv.includes("--static-tests") });
  const outIndex = process.argv.indexOf("--out");
  const json = `${JSON.stringify(inventory, null, 2)}\n`;
  if (outIndex !== -1) {
    const out = resolve(process.argv[outIndex + 1]);
    writeFileSync(out, json);
    console.error(`Wrote ${relative(process.cwd(), out)} (${inventory.files.length} files).`);
  } else process.stdout.write(json);
}

export { isTest };
