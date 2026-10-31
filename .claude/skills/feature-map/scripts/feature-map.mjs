#!/usr/bin/env node
// Builds the feature map end to end: collect the raw inventory (collect.mjs) into
// .claude/skills/feature-map/.cache/inventory.json, then render docs/feature-map/ (render.mjs).
//
//   npm run feature-map              # write the exports
//   npm run feature-map -- --strict  # also exit 1 when anything is unassigned
//   npm run feature-map -- --static-tests  # skip `vitest list` (~20 s); count it()/test() calls instead

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

import { collect, loadConfig, ROOT } from "./collect.mjs";
import { DEFAULT_INVENTORY, DEFAULT_OUT, render } from "./render.mjs";

const inventory = collect(loadConfig(), { vitest: !process.argv.includes("--static-tests") });
mkdirSync(dirname(DEFAULT_INVENTORY), { recursive: true });
writeFileSync(DEFAULT_INVENTORY, `${JSON.stringify(inventory, null, 2)}\n`);
const model = render({ inventory, outDir: DEFAULT_OUT });

const t = model.totals;
const out = relative(ROOT, DEFAULT_OUT);
console.log(`Feature map: ${t.features} features + ${t.infrastructure} infrastructure, ${t.files} files, ${t.pages} pages, ${t.apiRoutes} routes, ${t.tables} tables, ${t.mcpTools} MCP tools, ${t.workerJobs} worker jobs, ${t.testCases} test cases (unit/route/component counts from ${inventory.testCountSource}).`);
console.log(`Wrote ${out}/feature-map.json, ${out}/feature-map.md, ${out}/feature-map.html`);

const u = model.unassigned;
if (u.count) {
  console.log(`\nUnassigned (${u.count}) — add patterns to .claude/skills/feature-map/features.json, or leave them if they belong nowhere:`);
  for (const f of u.files) console.log(`  file      ${f.file}`);
  for (const x of u.tables) console.log(`  table     ${x.id}`);
  for (const x of u.functions) console.log(`  function  ${x.id}()${x.legacy ? " (legacy)" : ""}`);
  for (const x of u.buckets) console.log(`  bucket    ${x.id}`);
  for (const x of u.envVars) console.log(`  env       ${x.name} (${x.note})`);
  for (const x of u.mcpTools) console.log(`  mcp tool  ${x.name}`);
  for (const x of u.workerJobs) console.log(`  job       ${x.name}`);
  if (process.argv.includes("--strict")) process.exit(1);
} else console.log("Unassigned: none.");
