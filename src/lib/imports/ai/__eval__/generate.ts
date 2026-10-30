import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { FIXTURES_DIR, fixtureFiles } from "@/lib/imports/ai/__eval__/fixture-files";

/**
 * Writes the synthetic statements to `fixtures/` (docs/statement-import-plan.md, I19):
 * `npm run eval:statements:generate`. Everything is invented, and the output is byte for byte the
 * same every time, so a changed fixture is a reviewable diff. `eval.test.ts` fails when the files
 * on disk are not what `statements.ts` produces.
 *
 * Files in `fixtures/` that it doesn't produce are removed. George's anonymised samples go in
 * `samples/`, which this never touches.
 */

const files = fixtureFiles();
await mkdir(FIXTURES_DIR, { recursive: true });
for (const name of await readdir(FIXTURES_DIR)) {
  if (!files.has(name)) await rm(path.join(FIXTURES_DIR, name));
}
for (const [name, content] of files) await writeFile(path.join(FIXTURES_DIR, name), content);
console.log(`Wrote ${files.size} files (${files.size / 3} statements) to ${path.relative(process.cwd(), FIXTURES_DIR)}.`);
