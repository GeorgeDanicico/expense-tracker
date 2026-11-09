#!/usr/bin/env node
// The JavaScript a browser downloads to open each page, from the webpack build's manifests in `.next/`.
//
//   npm run build && npm run size:routes              a table, gzipped (what the network carries)
//   npm run size:routes -- --json                     the same as JSON, for diffing before and after
//   node scripts/route-js-size.mjs --dir path/.next   read another build
//   node scripts/route-js-size.mjs --routes /dashboard,/todos   only those routes
//   node scripts/route-js-size.mjs --all              include the /dev pages too
//
// "First-load JS" of a route is every script its HTML asks for: the framework files
// (`rootMainFiles` in build-manifest.json) plus the chunks of every client component in the route's
// layouts and page (`page_client-reference-manifest.js`). `polyfills-*.js` is left out because it is
// `nomodule`: a current browser never downloads it. Sizes are gzip at zlib's default level, the
// level Next's own compression uses, so they match what a browser receives over the wire to within
// a few bytes.
//
// What is counted is the chunks themselves, never a sum of their modules, so a chunk two pages share
// is counted once on each page (as the browser downloads it once per visit) and also reported as
// "shared". PF9 adds a `--check` mode against a budget file on top of the `--json` shape below.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

/** The directory of a page's app path with route groups kept: `/(app)/dashboard/page` -> `(app)/dashboard`. */
const directoryOf = (appPath) => appPath.slice(1, -"/page".length);

/** `/(app)/dashboard/page` -> `/dashboard`; `/page` -> `/`. Returns null for anything that isn't a page. */
export function routeFromAppPath(appPath) {
  if (!appPath.endsWith("/page")) return null;
  const segments = appPath
    .slice(0, -"/page".length)
    .split("/")
    .filter((segment) => segment !== "" && !(segment.startsWith("(") && segment.endsWith(")")));
  return `/${segments.join("/")}`;
}

/**
 * Whether the client module at `modulePath` (an absolute path, as a manifest keys it) is loaded for the
 * page at `appPath`. A manifest names the client modules of the whole tree it was built from, which
 * includes other pages' (`src/app/page.tsx` shows up in every route's), so a file under `src/app/<dir>/`
 * counts only when `<dir>` is the route's directory or one above it, and a `page` only when `<dir>` is
 * the route's own.
 */
export function loadsModule(appPath, modulePath) {
  const marker = modulePath.indexOf("/src/app/");
  if (marker === -1) return true; // not an app-directory file: a library or a component
  const relative = modulePath.slice(marker + "/src/app/".length);
  const slash = relative.lastIndexOf("/");
  const directory = slash === -1 ? "" : relative.slice(0, slash);
  const file = relative.slice(slash + 1);
  const routeDirectory = directoryOf(appPath);
  if (/^page\.[cm]?[jt]sx?$/.test(file)) return directory === routeDirectory;
  return directory === "" || routeDirectory === directory || routeDirectory.startsWith(`${directory}/`);
}

/**
 * The client chunks (`static/chunks/*.js`) that the page at `appPath` needs, from its
 * `page_client-reference-manifest.js`: every client component module lists the chunks it needs as
 * `[id, path, id, path, …]` (paths URL-encoded, `%5Bid%5D` for `[id]`; they are returned decoded, as on
 * disk). Runs the file the way Next's server does (it assigns to
 * `globalThis.__RSC_MANIFEST`) and restores what it replaced.
 */
export function chunksFromClientManifest(source, appPath) {
  const previous = globalThis.__RSC_MANIFEST;
  globalThis.__RSC_MANIFEST = {};
  try {
    new Function(source)();
    const manifest = Object.values(globalThis.__RSC_MANIFEST)[0];
    const found = new Set();
    for (const [modulePath, entry] of Object.entries(manifest?.clientModules ?? {})) {
      if (!loadsModule(appPath, modulePath)) continue;
      for (const chunk of entry.chunks ?? []) {
        if (/^static\/chunks\/.+\.js$/.test(chunk)) found.add(decodeURIComponent(chunk));
      }
    }
    return [...found];
  } finally {
    globalThis.__RSC_MANIFEST = previous;
  }
}

/** gzip and raw bytes of one built file, cached because most chunks are shared by many routes. */
export function createSizer(root, read = (path) => readFileSync(path)) {
  const cache = new Map();
  return (file) => {
    let size = cache.get(file);
    if (!size) {
      const bytes = read(join(root, file));
      size = { raw: bytes.length, gzip: gzipSync(bytes).length };
      cache.set(file, size);
    }
    return size;
  };
}

/**
 * Every page route of the build with its first-load files, from the manifests under `root` (`.next`).
 * Throws when a page has no client manifest: a route silently missing from the report would look like
 * a pass in a budget check.
 */
export function collectRoutes(root, { includeDev = false } = {}) {
  const readText = (path) => readFileSync(path, "utf8");
  const build = JSON.parse(readText(join(root, "build-manifest.json")));
  const paths = JSON.parse(readText(join(root, "server", "app-paths-manifest.json")));
  const framework = build.rootMainFiles ?? [];
  const routes = [];
  for (const appPath of Object.keys(paths).sort()) {
    const route = routeFromAppPath(appPath);
    if (route === null || route === "/_global-error") continue;
    if (!includeDev && (route === "/dev" || route.startsWith("/dev/"))) continue;
    const manifest = join(root, "server", "app", directoryOf(appPath), "page_client-reference-manifest.js");
    if (!existsSync(manifest)) throw new Error(`No client manifest for ${route}: expected ${manifest}`);
    const chunks = chunksFromClientManifest(readText(manifest), appPath);
    routes.push({ route, files: [...new Set([...framework, ...chunks])].sort() });
  }
  return routes;
}

/** The files every route loads. */
export function sharedFiles(routes) {
  if (routes.length === 0) return [];
  return routes[0].files.filter((file) => routes.every((entry) => entry.files.includes(file)));
}

/** The report: sizes per route, with what is shared by all routes and what is the route's own. */
export function buildReport(routes, sizeOf, buildId = null) {
  const shared = sharedFiles(routes);
  const total = (files) =>
    files.reduce((sum, file) => {
      const size = sizeOf(file);
      return { raw: sum.raw + size.raw, gzip: sum.gzip + size.gzip };
    }, { raw: 0, gzip: 0 });
  const sharedSet = new Set(shared);
  return {
    buildId,
    shared: { files: shared.length, ...total(shared) },
    routes: routes
      .map(({ route, files }) => {
        const all = total(files);
        const ownFiles = files.filter((file) => !sharedSet.has(file));
        return { route, files: files.length, rawBytes: all.raw, gzipBytes: all.gzip, ownGzipBytes: total(ownFiles).gzip, ownFiles };
      })
      .sort((a, b) => a.route.localeCompare(b.route)),
  };
}

const kb = (bytes) => (bytes / 1024).toFixed(1);

/** The report as a plain-text table: route, files, raw KiB, gzip KiB, and the gzip KiB that is the route's own. */
export function formatTable(report) {
  const rows = [["Route", "Files", "Raw KiB", "Gzip KiB", "Own gzip KiB"]];
  for (const entry of report.routes) rows.push([entry.route, String(entry.files), kb(entry.rawBytes), kb(entry.gzipBytes), kb(entry.ownGzipBytes)]);
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  const line = (row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[0]) : cell.padStart(widths[column]))).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const lines = [line(rows[0]), divider, ...rows.slice(1).map(line)];
  lines.push("", `Shared by every route: ${report.shared.files} files, ${kb(report.shared.raw)} KiB raw, ${kb(report.shared.gzip)} KiB gzip.`);
  return lines.join("\n");
}

function parseArguments(argv) {
  const { values } = parseArgs({
    args: argv,
    options: { dir: { type: "string", default: ".next" }, json: { type: "boolean" }, all: { type: "boolean" }, routes: { type: "string" } },
  });
  return { ...values, routes: values.routes ? new Set(values.routes.split(",").filter(Boolean)) : null };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (!existsSync(join(options.dir, "build-manifest.json"))) {
    console.error(`No webpack build in ${options.dir}. Run \`npm run build\` first.`);
    process.exit(1);
  }
  let routes = collectRoutes(options.dir, { includeDev: options.all });
  if (options.routes) routes = routes.filter((entry) => options.routes.has(entry.route));
  const buildIdPath = join(options.dir, "BUILD_ID");
  const buildId = existsSync(buildIdPath) ? readFileSync(buildIdPath, "utf8").trim() : null;
  // The shared set is the intersection over the routes asked for, so `--routes` changes it.
  const report = buildReport(routes, createSizer(options.dir), buildId);
  console.log(options.json ? JSON.stringify(report, null, 2) : formatTable(report));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
