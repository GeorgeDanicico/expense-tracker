import path from "node:path";

import { generateAll } from "@/lib/imports/ai/__eval__/statements";

/** Where the generated statements are kept, relative to the repository root (the eval runs from there). */
export const FIXTURES_DIR = path.join(process.cwd(), "src/lib/imports/ai/__eval__/fixtures");

/** JSON with the first two levels spread over lines and everything below on one line, so a row is one line in a diff. */
function pretty(value: unknown, depth = 0): string {
  const inline = depth >= 2 || value === null || typeof value !== "object";
  if (inline) return JSON.stringify(value);
  const indent = "  ".repeat(depth + 1);
  const close = "  ".repeat(depth);
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : `[\n${value.map((item) => indent + pretty(item, depth + 1)).join(",\n")}\n${close}]`;
  }
  const entries = Object.entries(value);
  return entries.length === 0 ? "{}" : `{\n${entries.map(([key, item]) => `${indent}${JSON.stringify(key)}: ${pretty(item, depth + 1)}`).join(",\n")}\n${close}}`;
}

/**
 * Every file the generator owns, by name: for each synthetic statement the file itself
 * (`<id>.csv` or `<id>.pdf`), `<id>.expected.json` (the rows and categories it should be read as)
 * and `<id>.answer.json` (what a perfect model answers, which `--dry-run` plays back).
 */
export function fixtureFiles(): Map<string, Uint8Array | string> {
  const files = new Map<string, Uint8Array | string>();
  for (const statement of generateAll()) {
    files.set(`${statement.id}.${statement.kind}`, statement.bytes);
    files.set(`${statement.id}.expected.json`, `${pretty(statement.expected)}\n`);
    files.set(`${statement.id}.answer.json`, `${pretty(statement.answer)}\n`);
  }
  return files;
}
