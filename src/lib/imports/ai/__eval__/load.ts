import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { EXPENSE_CATEGORIES, EXPENSE_SUBTYPES } from "@/lib/expenses/categories";
import { FIXTURES_DIR } from "@/lib/imports/ai/__eval__/fixture-files";
import type { EvalStatement, Expected } from "@/lib/imports/ai/__eval__/types";
import { readerSchema } from "@/lib/imports/ai/prompts";
import { buildTextPdf, type PdfLine, type PdfPage } from "@/test/pdf";

/**
 * Reads the eval's statements from disk (docs/statement-import-plan.md, I19): the generated ones in
 * `fixtures/` and George's anonymised samples in `samples/`, which have the same shape. A statement
 * is `<id>.csv`, `<id>.pdf` or `<id>.txt` plus `<id>.expected.json`, and optionally
 * `<id>.answer.json`.
 *
 * A `.txt` is the text of a PDF statement (the plan's way to anonymise one: paste its text into a
 * file and replace the values): one PDF line per line, a tab between the cells of a table row, and
 * a line `=== page ===` to start a new page. It is turned into a text PDF with the test helper
 * (`src/test/pdf.ts`), and the eval then reads that PDF the way an upload is read.
 */

export const SAMPLES_DIR = path.join(process.cwd(), "src/lib/imports/ai/__eval__/samples");

const amount = z.string().regex(/^\d+\.\d{2}$/, "an amount with two decimals, such as 45.20");
const currency = z.string().regex(/^[A-Z]{3}$/, "three uppercase letters");

export const expectedSchema = z.object({
  description: z.string().min(1),
  currency: currency.nullable(),
  parser: z.enum(["ok", "none", "refused"]).nullable().optional(),
  knownGap: z.object({ reason: z.string(), note: z.string() }).nullable().optional(),
  rows: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"),
      amount,
      currency,
      direction: z.enum(["debit", "credit"]),
      merchant: z.string().min(1),
      category: z.enum(EXPENSE_CATEGORIES),
      subtype: z.enum(EXPENSE_SUBTYPES).nullable(),
    }),
  ),
});

const PAGE_BREAK = "=== page ===";

/** The PDF of a `.txt` sample. The columns share the page's width. */
export function pdfFromText(text: string): Uint8Array {
  const pages: PdfPage[] = [[]];
  let cellsMost = 1;
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.trim() === PAGE_BREAK) {
      pages.push([]);
      continue;
    }
    if (line.trim() === "") continue;
    const cells = line.split("\t").map((cell) => cell.trim()).filter(Boolean);
    cellsMost = Math.max(cellsMost, cells.length);
    (pages[pages.length - 1] as PdfLine[]).push(cells.length > 1 ? cells : (cells[0] ?? ""));
  }
  return buildTextPdf(pages, { columnWidth: Math.min(250, Math.max(60, Math.floor(480 / cellsMost))) });
}

async function readIfExists(file: string): Promise<Buffer | null> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function loadDir(dir: string): Promise<EvalStatement[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const statements: EvalStatement[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".expected.json")).sort()) {
    const id = name.slice(0, -".expected.json".length);
    const where = path.relative(process.cwd(), path.join(dir, name));

    const parsed = expectedSchema.safeParse(JSON.parse(await readFile(path.join(dir, name), "utf8")));
    if (!parsed.success) throw new Error(`${where} isn't a valid expected file: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    const expected: Expected = { ...parsed.data, parser: parsed.data.parser ?? null, knownGap: parsed.data.knownGap ?? null };

    let kind: EvalStatement["kind"];
    let bytes: Uint8Array;
    const csv = await readIfExists(path.join(dir, `${id}.csv`));
    const pdf = await readIfExists(path.join(dir, `${id}.pdf`));
    const text = await readIfExists(path.join(dir, `${id}.txt`));
    if (csv) {
      kind = "csv";
      bytes = csv;
    } else if (pdf) {
      kind = "pdf";
      bytes = pdf;
    } else if (text) {
      kind = "pdf";
      bytes = pdfFromText(text.toString("utf8"));
    } else {
      throw new Error(`${where} has no ${id}.csv, ${id}.pdf or ${id}.txt beside it.`);
    }

    const answerFile = await readIfExists(path.join(dir, `${id}.answer.json`));
    const answer = answerFile ? readerSchema.parse(JSON.parse(answerFile.toString("utf8"))) : null;
    statements.push({ id, kind, bytes, expected, answer });
  }
  return statements;
}

/** The statements of every directory, in id order within each; an id used twice is an error. */
export async function loadStatements(dirs: readonly string[] = [FIXTURES_DIR, SAMPLES_DIR]): Promise<EvalStatement[]> {
  const all: EvalStatement[] = [];
  for (const dir of dirs) all.push(...(await loadDir(dir)));
  const seen = new Set<string>();
  for (const statement of all) {
    if (seen.has(statement.id)) throw new Error(`Two statements are called ${statement.id}.`);
    seen.add(statement.id);
  }
  return all;
}
