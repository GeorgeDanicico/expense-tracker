#!/usr/bin/env node
// Fails when a package that only the server may use is inside a chunk the browser downloads (PF9).
//
//   BUNDLE_MODULES=1 npm run build && node scripts/server-only-check.mjs
//   node scripts/server-only-check.mjs --dir path/.next    read another build
//
// It reads `.next/diagnostics/client-modules.json`, which `scripts/client-modules-plugin.mjs` writes during a
// webpack build run with `BUNDLE_MODULES=1`: for each browser chunk, the modules in it. These packages must
// never be in one: they hold secrets' worth of code and weight (the AI client, the PDF reader, web push, the image
// resizer, the zip library, the MCP server). If one is, a client component imports a server file, directly or
// through another: fix that import and add `import "server-only"` to the file that pulled the package in, so the build
// fails the next time instead of this check.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The packages the browser must not receive, as `node_modules/<name>/` paths. */
export const SERVER_ONLY_PACKAGES = ["openai", "unpdf", "web-push", "sharp", "fflate", "@modelcontextprotocol/server"];

/** The browser chunks that hold a module of a server-only package: `{ package, chunk, module }` for each. */
export function findServerOnly(chunks, packages = SERVER_ONLY_PACKAGES) {
  const found = [];
  for (const [chunk, modules] of Object.entries(chunks)) {
    for (const { name } of modules) {
      const hit = packages.find((pkg) => name.includes(`node_modules/${pkg}/`));
      if (hit) found.push({ package: hit, chunk, module: name });
    }
  }
  return found;
}

function main() {
  const { values } = parseArgs({ options: { dir: { type: "string", default: ".next" } } });
  const file = join(values.dir, "diagnostics", "client-modules.json");
  if (!existsSync(file)) {
    console.error(`No ${file}. Build with \`BUNDLE_MODULES=1 npm run build\` first.`);
    process.exit(1);
  }
  const { chunks } = JSON.parse(readFileSync(file, "utf8"));
  const modules = Object.values(chunks).reduce((sum, list) => sum + list.length, 0);
  // A build that recorded nothing would pass by accident.
  if (modules < 100 || !Object.values(chunks).some((list) => list.some(({ name }) => name.includes("node_modules/react-dom/") || name.includes("node_modules/next/")))) {
    console.error(`${file} lists ${modules} modules and none of Next or React: the build did not record the browser's chunks.`);
    process.exit(1);
  }
  const found = findServerOnly(chunks);
  if (found.length > 0) {
    for (const hit of found) console.error(`${hit.package} is in a browser chunk: ${hit.chunk} (${hit.module})`);
    console.error(`Server-only code reached the browser. Fix the import; add \`import "server-only"\` to the file that pulled the package in.`);
    process.exit(1);
  }
  console.log(`No server-only package (${SERVER_ONLY_PACKAGES.join(", ")}) in the ${Object.keys(chunks).length} browser chunks (${modules} modules).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
