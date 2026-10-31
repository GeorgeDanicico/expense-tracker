#!/usr/bin/env node
// Renders the feature map: reads the raw inventory written by collect.mjs, groups it with
// features.json (group.mjs) and writes docs/feature-map/feature-map.{json,md,html}.
//
//   node .claude/skills/feature-map/scripts/render.mjs [--in <inventory.json>] [--out <dir>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { group } from "./group.mjs";
import { htmlPage } from "./lib/html.mjs";

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(SKILL_DIR, "../../..");
export const DEFAULT_INVENTORY = join(SKILL_DIR, ".cache", "inventory.json");
export const DEFAULT_OUT = join(ROOT, "docs", "feature-map");

const KIND_LABEL = { imports: "imports", types: "type imports", api: "API calls", db: "database calls", sql: "SQL references", worker: "worker jobs" };

// ── Markdown helpers ───────────────────────────────────────────────────────────────────────────

const cell = (value) => String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const code = (value) => (value ? `\`${String(value).replace(/`/g, "'")}\`` : "");

function table(headers, rows) {
  if (!rows.length) return "";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
    "",
  ].join("\n");
}

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const short = (path) => path.replace(/^src\//, "");

function accessText(route) {
  const groups = new Map();
  for (const method of route.methods) {
    const label = method.auth === "withPermission"
      ? `withPermission(${method.permission?.module ?? "?"}, ${method.permission?.level ?? "?"})`
      : method.auth;
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(method.method);
  }
  const parts = [...groups].map(([label, methods]) => (groups.size > 1 ? `${methods.join("/")}: ${label}` : label));
  if (route.familyFlag) parts.push("family flag");
  const custom = route.guards.filter((guard) => guard !== "requireFamilyFeature");
  if (custom.length && route.methods.every((m) => !m.auth.startsWith("with"))) parts.push(`checks: ${custom.join(", ")}`);
  return parts.join("; ");
}

function linkKinds(kinds) {
  return Object.entries(kinds).map(([kind, count]) => `${KIND_LABEL[kind] ?? kind} ${count}`).join(", ");
}

function testSummary(totals) {
  const parts = ["unit", "component", "page", "route", "db"]
    .filter((kind) => totals[kind].files)
    .map((kind) => `${kind} ${totals[kind].cases} in ${plural(totals[kind].files, "file")}`);
  return parts.length ? parts.join(", ") : "none";
}

const mermaidId = (id) => id.replace(/[^A-Za-z0-9]/g, "_");

export function mermaid(model) {
  const shown = new Set(model.features.filter((f) => f.diagram).map((f) => f.id));
  const lines = ["flowchart LR"];
  for (const feature of model.features.filter((f) => shown.has(f.id))) {
    const shape = feature.kind === "feature" ? [`["`, `"]`] : [`[("`, `")]`];
    lines.push(`  ${mermaidId(feature.id)}${shape[0]}${feature.name.replace(/"/g, "'")}${shape[1]}`);
  }
  for (const l of model.links) {
    if (!shown.has(l.from) || !shown.has(l.to)) continue;
    const strong = ["imports", "api", "db"].some((kind) => l.kinds[kind]);
    const weak = ["sql", "worker"].some((kind) => l.kinds[kind]);
    if (!strong && !weak) continue; // type-only imports
    lines.push(`  ${mermaidId(l.from)} ${strong ? "-->" : "-.->"} ${mermaidId(l.to)}`);
  }
  return lines.join("\n");
}

function featureSection(feature, model) {
  const name = (id) => model.featureName[id] ?? id;
  const out = [];
  out.push(`## ${feature.name}`, "");
  out.push(`<a id="${feature.id}"></a>`, "");
  out.push(`${feature.summary}${feature.kind === "infrastructure" ? " _(Shared infrastructure, not a user-facing module.)_" : ""}`, "");
  const s = feature.stats;
  out.push(
    `**At a glance:** ${plural(s.files, "file")} (${s.lines.toLocaleString("en-US")} lines), ${plural(s.pages, "page")}, ${plural(s.apiRoutes, "route")}, ` +
      `${plural(s.tables, "table")}, ${plural(s.functions, "SQL function")}, ${plural(s.policies, "RLS policy", "RLS policies")}, ` +
      `${plural(s.mcpTools, "MCP tool")}, ${plural(s.workerJobs, "worker job")}. ` +
      `**Tests:** ${s.tests.cases} cases in ${plural(s.tests.files, "file")} (${testSummary(feature.testTotals)}).`,
    "",
  );
  if (feature.docs.length) out.push(`**Plans and docs:** ${feature.docs.map((doc) => `[${doc}](../../${doc})`).join(", ")}`, "");

  if (feature.pages.length) {
    out.push("### Pages", "");
    out.push(table(["Route", "Route group", "Navigation", "Access", "File"], feature.pages.map((page) => [
      code(page.route),
      page.group,
      page.nav ? `${page.nav.place}: "${page.nav.label}"${page.nav.section ? ` (${page.nav.section})` : ""}${page.nav.mobileTabBar ? ", mobile tab bar" : ""}${page.nav.requiresFamily ? ", family only" : ""}` : "none",
      [page.permissionGate.length ? `PermissionGate(${page.permissionGate.join(", ")})` : "", page.nav?.module ? `nav needs ${page.nav.module}` : "", page.devOnly ? "dev only" : ""].filter(Boolean).join("; ") || "signed-in layout" ,
      code(short(page.file)),
    ])));
  }

  if (feature.apiRoutes.length) {
    out.push("### API routes", "");
    out.push(table(["Route", "Methods", "Access", "Called from", "File"], feature.apiRoutes.map((route) => [
      code(route.route),
      route.methods.map((m) => m.method).join(", "),
      accessText(route),
      route.calledFrom.length
        ? [...new Set(route.calledFrom.map((c) => (c.feature === feature.id ? short(c.file).split("/").pop() : `${name(c.feature)}: ${short(c.file).split("/").pop()}`)))].join(", ")
        : "not called from app code",
      code(short(route.file)),
    ])));
  }

  const libRows = feature.lib.map((lib) => [code(short(lib.file)), lib.role, lib.description ?? ""]);
  if (libRows.length) {
    out.push("### Library modules", "");
    out.push(table(["Module", "Role", "What it does"], libRows));
  }
  if (feature.components.length || feature.hooks.length || feature.borrowed.length || feature.otherFiles.length) {
    out.push("### Components, hooks and other files", "");
    if (feature.components.length) out.push(`**Components (${feature.components.length}):** ${feature.components.map((c) => code(short(c.file).replace(/^components\//, ""))).join(", ")}`, "");
    if (feature.hooks.length) out.push(`**Hooks:** ${feature.hooks.map((h) => code(short(h.file).replace(/^hooks\//, ""))).join(", ")}`, "");
    const borrowedComponents = feature.borrowed.filter((b) => b.feature !== "design-system");
    if (borrowedComponents.length) {
      out.push(`**Uses from other features:** ${borrowedComponents.map((b) => `${code(short(b.file).replace(/^(components|hooks)\//, ""))} (${name(b.feature)})`).join(", ")}`, "");
    }
    const ui = feature.borrowed.filter((b) => b.feature === "design-system");
    if (ui.length) out.push(`**UI kit primitives used:** ${ui.map((b) => code(short(b.file).replace(/^components\/ui\//, ""))).join(", ")}`, "");
    if (feature.otherFiles.length) out.push(`**Other files:** ${feature.otherFiles.map((f) => `${code(short(f.file))} (${f.kind})`).join(", ")}`, "");
  }

  if (feature.tables.length || feature.functions.length || feature.buckets.length) {
    out.push("### Database", "");
    if (feature.tables.length) {
      out.push(table(["Table", "RLS", "Policies", "Triggers", "Created in", "Tested by"], feature.tables.map((t) => [
        `${code(t.id)}${t.comment ? ` — ${t.comment}` : ""}`,
        t.external ? "Supabase-managed" : t.rls ? "on" : "**off**",
        t.policies.map((p) => `${p.name} (${p.command})`).join(", ") || "none",
        t.triggers.map((tr) => `${tr.name} → ${tr.fn.replace(/^public\./, "")}()`).join(", ") || "none",
        t.external ? "Supabase" : t.legacy ? "before migrations (legacy)" : t.createdIn ? short(t.createdIn.split(":")[0]).replace(/^supabase\/migrations\//, "") : "",
        t.testedBy.map((path) => path.replace("supabase/tests/", "")).join(", ") || "no SQL test",
      ])));
    }
    if (feature.functions.length) {
      out.push(table(["SQL function", "Kind", "Called from app code", "Tested by"], feature.functions.map((fn) => [
        `${code(`${fn.id}()`)}${fn.comment ? ` — ${fn.comment}` : ""}`,
        [fn.returnsTrigger ? "trigger" : "function", fn.securityDefiner ? "security definer" : "", fn.legacy ? "legacy" : ""].filter(Boolean).join(", "),
        fn.calledFrom.length ? fn.calledFrom.map((p) => short(p).split("/").pop()).join(", ") : fn.triggerOn.length ? `trigger on ${fn.triggerOn.join(", ")}` : "SQL only",
        fn.testedBy.map((path) => path.replace("supabase/tests/", "")).join(", ") || "no SQL test",
      ])));
    }
    if (feature.buckets.length) out.push(`**Storage buckets:** ${feature.buckets.map((b) => code(b.id)).join(", ")}`, "");
    if (feature.migrations.length) out.push(`**Migrations:** ${feature.migrations.map((m) => code(m.replace("supabase/migrations/", ""))).join(", ")}`, "");
  }

  if (feature.mcpTools.length) {
    out.push("### MCP tools", "");
    out.push(table(["Tool", "Access", "Permission module", "Only while", "File"], feature.mcpTools.map((tool) => [
      code(tool.name), tool.access ?? "", tool.module ?? "none (open to every user)", tool.gatedBy ? `${tool.gatedBy}()` : "always", code(short(tool.file)),
    ])));
  }
  if (feature.workerJobs.length) {
    out.push("### Worker jobs", "");
    out.push(table(["Job", "What it does", "Tables and RPCs", "Features touched"], feature.workerJobs.map((job) => [
      code(job.name), job.description ?? "", [...job.tables, ...job.rpcs.map((r) => `${r}()`)].join(", "), job.features.map(name).join(", "),
    ])));
  }
  if (feature.flags.length || feature.envVars.length) {
    out.push("### Feature flags and environment", "");
    for (const flag of feature.flags) {
      out.push(`- Flag ${code(flag.env.join(", "))} via ${flag.via.map((v) => code(`${v}()`)).join(", ")} in ${plural(flag.files.length, "file")}.`);
    }
    for (const env of feature.envVars) out.push(`- Env ${code(env.name)}${env.inEnvExample ? "" : " (not in .env.example)"}: read in ${env.files.map((f) => code(short(f))).join(", ")}.`);
    out.push("");
  }
  if (feature.tests.length) {
    out.push("### Tests", "");
    out.push(table(["Test file", "Kind", "Cases"], feature.tests.map((t) => [code(short(t.file)), t.kind, t.cases])));
  }
  if (feature.dependsOn.length || feature.usedBy.length) {
    out.push("### Links to other features", "");
    if (feature.dependsOn.length) out.push(`**Depends on:** ${feature.dependsOn.map((d) => `${name(d.feature)} (${linkKinds(d.kinds)})`).join("; ")}`, "");
    if (feature.usedBy.length) out.push(`**Used by:** ${feature.usedBy.map((d) => `${name(d.feature)} (${linkKinds(d.kinds)})`).join("; ")}`, "");
  }
  return out.join("\n");
}

export function markdown(model) {
  const t = model.totals;
  const name = (id) => model.featureName[id] ?? id;
  const out = [];
  out.push("# Feature map", "");
  out.push(
    "_Generated by `npm run feature-map` (`.claude/skills/feature-map`). Do not edit by hand: change " +
      "`.claude/skills/feature-map/features.json` or the scripts and run it again._",
    "",
  );
  out.push(
    `The app has **${t.features} features** plus ${t.infrastructure} shared infrastructure areas, built from ${t.files} source files: ` +
      `${t.pages} pages, ${t.apiRoutes} route handlers, ${t.tables} tables, ${t.functions} SQL functions, ${t.policies} RLS policies, ` +
      `${t.migrations} migrations, ${t.mcpTools} MCP tools and ${t.workerJobs} worker jobs. ` +
      `Tests: ${t.testCases.toLocaleString("en-US")} cases in ${t.testFiles} files. Unassigned items: **${t.unassigned}**.`,
    "",
  );
  out.push(
    (model.testCountSource === "vitest list"
      ? "Unit, route, component and page test cases come from `vitest list` (each it.each row counts); a database test file counts its pgTAP `plan(n)`. "
      : "Test cases are counted statically (an `it(…)`/`test(…)` call; an `it.each` or a test inside a loop counts once, so these undercount); a database test file counts its pgTAP `plan(n)`. ") +
      "\"Depends on\" means the feature's code or SQL uses the other one: imports, calls its API routes, reads its tables or calls its SQL functions, " +
      "or (for the worker) runs a job over its data.",
    "",
  );

  out.push("## Features", "");
  out.push(table(["Feature", "Pages", "Routes", "Tables", "MCP tools", "Worker jobs", "Test cases", "Depends on"], model.features.map((f) => [
    `[${f.name}](#${f.id})${f.kind === "infrastructure" ? " (infra)" : ""}`,
    f.stats.pages, f.stats.apiRoutes, f.stats.tables, f.stats.mcpTools, f.stats.workerJobs, f.stats.tests.cases,
    f.dependsOn.filter((d) => Object.keys(d.kinds).some((k) => k !== "types")).map((d) => name(d.feature)).join(", "),
  ])));

  out.push("## Dependency diagram", "");
  out.push("Solid arrows: code imports, API calls or database calls. Dashed: only SQL references or worker jobs. Rounded nodes are shared infrastructure.", "");
  out.push("```mermaid", mermaid(model), "```", "");

  out.push("## Navigation", "");
  out.push(table(["Entry", "Where", "Section", "Needs", "Feature"], model.nav.map((item) => {
    const page = model.features.find((f) => f.pages.some((p) => p.route === item.href));
    return [
      `${item.label} (${code(item.href)})`,
      item.place + (item.mobileTabBar ? ", mobile tab bar" : ""),
      item.section ?? "",
      [item.module ? `${item.module} permission` : "", item.requiresFamily ? "a family" : ""].filter(Boolean).join(", ") || "nothing",
      page ? page.name : "",
    ];
  })));

  out.push("## Feature flags", "");
  for (const flag of model.flags) {
    const features = [...new Set(model.features.filter((f) => f.flags.some((x) => x.name === flag.name)).map((f) => f.name))];
    out.push(`- ${code(`${flag.name}()`)} reads ${flag.env.map(code).join(", ")}${flag.description ? `: ${flag.description}` : ""} Wrapped by ${flag.guards.map((g) => code(`${g.name}()`)).join(", ") || "nothing"}. Used by: ${features.join(", ")}.`);
  }
  out.push("");

  out.push("## Environment variables", "");
  out.push(table(["Variable", "In .env.example", "Read by", "Features"], model.envVars.map((env) => [
    code(env.name), env.inEnvExample ? "yes" : "no", env.usedIn.map((p) => code(short(p))).join(", ") || "nothing in src/", env.features.map(name).join(", "),
  ])));

  for (const feature of model.features) out.push(featureSection(feature, model), "");

  out.push("## Unassigned", "");
  const u = model.unassigned;
  if (!u.count) out.push("Nothing: every file, table, function, bucket, env var, MCP tool and worker job belongs to a feature.", "");
  else {
    out.push("These belong to no feature in `features.json`. Either add a pattern for them, or leave them here if they really belong nowhere.", "");
    for (const file of u.files) out.push(`- File ${code(file.file)} (${file.kind})${file.description ? `: ${file.description}` : ""}`);
    for (const t of u.tables) out.push(`- Table ${code(t.id)}${t.createdIn ? ` (created in ${code(t.createdIn)})` : ""}`);
    for (const fn of u.functions) out.push(`- SQL function ${code(`${fn.id}()`)}${fn.legacy ? " — legacy: exists before the migrations, stubbed in supabase/tests/support/legacy-bootstrap.sql, not used by the app" : ""}${fn.comment ? `: ${fn.comment}` : ""}`);
    for (const b of u.buckets) out.push(`- Storage bucket ${code(b.id)}`);
    for (const env of u.envVars) out.push(`- Env var ${code(env.name)}: ${env.note}${env.inEnvExample ? " (listed in .env.example)" : ""}`);
    for (const tool of u.mcpTools) out.push(`- MCP tool ${code(tool.name)} in ${code(tool.file)}`);
    for (const job of u.workerJobs) out.push(`- Worker job ${code(job.name)}`);
    out.push("");
  }
  if (model.ignored.length) {
    out.push("Deliberately ignored (`ignore` in features.json):", "");
    for (const entry of model.ignored) out.push(`- ${code(entry.path)}: ${entry.reason}`);
    out.push("");
  }
  return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

export function render({ inventoryPath = DEFAULT_INVENTORY, outDir = DEFAULT_OUT, inventory } = {}) {
  const config = JSON.parse(readFileSync(join(SKILL_DIR, "features.json"), "utf8"));
  const raw = inventory ?? JSON.parse(readFileSync(inventoryPath, "utf8"));
  const model = group(raw, config);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const json = { ...model };
  writeFileSync(join(outDir, "feature-map.json"), `${JSON.stringify(json, null, 2)}\n`);
  writeFileSync(join(outDir, "feature-map.md"), markdown(model));
  writeFileSync(join(outDir, "feature-map.html"), htmlPage(model));
  return model;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (flag) => (process.argv.includes(flag) ? resolve(process.argv[process.argv.indexOf(flag) + 1]) : undefined);
  const outDir = arg("--out") ?? DEFAULT_OUT;
  const model = render({ inventoryPath: arg("--in") ?? DEFAULT_INVENTORY, outDir });
  console.log(`Wrote ${relative(process.cwd(), outDir)}/feature-map.{json,md,html}: ${model.totals.features} features, ${model.totals.unassigned} unassigned.`);
}
