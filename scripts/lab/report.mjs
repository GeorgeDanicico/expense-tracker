#!/usr/bin/env node
// One table from several `scripts/lab/measure.mjs` result folders (docs/lab.md).
//
//   node scripts/lab/report.mjs <results folder> [<results folder> …]
//
// Each folder's summary.json says its JWT mode and delay, so a sweep made by scripts/lab/baseline.sh
// becomes one row per page, user, JWT mode and delay. Medians, with ± half the spread of the runs.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { fmt, ms } from "./measure.mjs";

/** `mobile`, `cpu` or `none` (results from before `throttleMode` was recorded were all `mobile`). */
const throttleOf = (context) => context.throttleMode ?? "mobile";

/** The table's columns: a heading, whether it's a number (right-aligned), and the cell. */
const COLUMNS = [
  ["Page", false, ({ summary }) => `\`${summary.page}\``],
  ["User", false, ({ summary }) => summary.user],
  ["JWT", false, ({ context }) => context.jwtMode],
  ["Delay", false, ({ context }) => `${context.delayMs} ms`],
  ["Throttle", false, ({ context }) => throttleOf(context)],
  ["Content (ms)", true, ({ summary }) => ms(summary.observed.content)],
  ["Settled (ms)", true, ({ summary }) => ms(summary.observed.settled)],
  ["LCP observed (ms)", true, ({ summary }) => ms(summary.observed.lcp)],
  ["LCP was", false, ({ summary }) => [...new Set(summary.lcpKinds)].join("/")],
  ["LCP Lighthouse (ms)", true, ({ summary }) => ms(summary.lighthouse?.lcp)],
  ["TBT Lighthouse (ms)", true, ({ summary }) => ms(summary.lighthouse?.tbt)],
  ["TTI Lighthouse (ms)", true, ({ summary }) => ms(summary.lighthouse?.tti)],
  ["CLS observed", true, ({ summary }) => fmt(summary.observed.cls.median ?? 0, 3)],
  ["Depth", true, ({ summary }) => fmt(summary.observed.waterfallDepth.median)],
  ["API req.", true, ({ summary }) => fmt(summary.server.apiRequests.median)],
  ["Supabase calls", true, ({ summary }) => fmt(summary.server.supabaseCalls.median)],
  ["Auth calls", true, ({ summary }) => fmt(summary.server.authCalls.median)],
  ["Data in HTML", false, ({ summary }) => (summary.dataInFirstHtml.some(Boolean) ? "yes" : "no")],
];

export function table(results) {
  const rows = results.flatMap(({ context, summaries }) => summaries.map((summary) => COLUMNS.map(([, , cell]) => cell({ context, summary }))));
  return [
    `| ${COLUMNS.map(([heading]) => heading).join(" | ")} |`,
    `| ${COLUMNS.map(([, number]) => (number ? "---:" : "---")).join(" | ")} |`,
    ...rows.map((cells) => `| ${cells.join(" | ")} |`),
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const folders = process.argv.slice(2);
  if (folders.length === 0) {
    console.error("usage: node scripts/lab/report.mjs <results folder> …");
    process.exit(2);
  }
  console.log(table(folders.map((folder) => JSON.parse(readFileSync(join(folder, "summary.json"), "utf8")))));
}
