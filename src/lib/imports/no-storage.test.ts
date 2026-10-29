import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * A statement is only ever read into memory, parsed and dropped (docs/statement-import-plan.md):
 * never written to disk or to Supabase Storage. This scans the sources of the import code for the
 * ways of doing that. Test files are skipped, because the fixtures test legitimately reads files.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const SCANNED = ["lib/imports", "app/api/imports"];

const FORBIDDEN: { name: string; pattern: RegExp }[] = [
  { name: "node:fs", pattern: /node:fs\b/ },
  { name: "fs", pattern: /(?:from|import|require)\s*\(?\s*["']fs(?:\/promises)?["']/ },
  { name: "fs/promises", pattern: /fs\/promises/ },
  { name: "node:os (temp files)", pattern: /node:os\b|\btmpdir\b/ },
  { name: ".storage", pattern: /\.storage\b/ },
  { name: "createWriteStream", pattern: /createWriteStream|writeFileSync|writeFile\(/ },
];

function sources(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return entry === "__fixtures__" ? [] : sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

const files = SCANNED.flatMap((directory) => sources(join(SRC, directory)));

describe("the import code never writes a statement anywhere", () => {
  it("scans the import sources", () => {
    expect(files.some((file) => file.endsWith("pipeline.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("upload.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith("generic-csv.ts"))).toBe(true);
    expect(files.some((file) => file.endsWith(".test.ts"))).toBe(false);
  });

  it.each(FORBIDDEN)("uses no $name", ({ pattern }) => {
    for (const file of files) {
      expect(pattern.test(readFileSync(file, "utf8")), file).toBe(false);
    }
  });

  it("recognises what it looks for", () => {
    expect(FORBIDDEN[0].pattern.test('import { readFileSync } from "node:fs";')).toBe(true);
    expect(FORBIDDEN[1].pattern.test('import fs from "fs";')).toBe(true);
    expect(FORBIDDEN[2].pattern.test('import { readFile } from "fs/promises";')).toBe(true);
    expect(FORBIDDEN[4].pattern.test('supabase.storage.from("x")')).toBe(true);
    expect(FORBIDDEN[4].pattern.test("const storage = 1;")).toBe(false);
  });
});
