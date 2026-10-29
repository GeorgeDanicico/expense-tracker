import { extractTextItems, getDocumentProxy, type StructuredTextItem } from "unpdf";

import { IMPORT_MAX_PDF_PAGES, ImportError } from "@/lib/imports/types";

/**
 * Reads the text of a PDF statement as pages of lines (docs/statement-import-plan.md, task I12).
 * pdf.js (through `unpdf`, a serverless build of it) gives every piece of text with its position;
 * the pieces on one baseline become a line, and a large horizontal gap inside a line becomes a tab,
 * so a statement laid out as a table keeps its columns for a parser to split on `\t`.
 *
 * The bytes are only held in memory, and nothing here logs or keeps them. Every error is an
 * `ImportError` whose message never contains text from the file.
 */

/** Two pieces are on the same line when their baselines differ by less than this share of the font size. */
const BASELINE_TOLERANCE = 0.5;
/** A gap wider than this many font sizes starts a new column (a word space is about a quarter of one). */
const COLUMN_GAP = 1;
/** A gap wider than this many font sizes, and no space on either side of it, is a word space. */
const WORD_GAP = 0.15;

type Piece = Pick<StructuredTextItem, "str" | "x" | "y" | "width" | "fontSize">;

/** The text of one page: its lines from the top down, each one's columns separated by a tab. Blank lines are dropped. */
function linesOf(items: readonly StructuredTextItem[]): string[] {
  const pieces: Piece[] = items.filter(
    (item) => item.str.trim() !== "" && Number.isFinite(item.x) && Number.isFinite(item.y) && Number.isFinite(item.width),
  );
  // Top of the page first: PDF coordinates start at the bottom-left, so a larger y is higher up.
  pieces.sort((a, b) => b.y - a.y || a.x - b.x);

  const rows: Piece[][] = [];
  for (const piece of pieces) {
    const row = rows.at(-1);
    const tolerance = Math.max(piece.fontSize, row?.[0].fontSize ?? 0, 1) * BASELINE_TOLERANCE;
    if (row && row[0].y - piece.y <= tolerance) row.push(piece);
    else rows.push([piece]);
  }

  const lines: string[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    const cells: string[] = [];
    let end = Number.NEGATIVE_INFINITY;
    let previous = "";
    for (const piece of row) {
      const size = Math.max(piece.fontSize, 1);
      const gap = piece.x - end;
      if (cells.length === 0 || gap > size * COLUMN_GAP) {
        cells.push(piece.str);
      } else {
        const joined = /\s$/.test(previous) || /^\s/.test(piece.str) || gap <= size * WORD_GAP ? "" : " ";
        cells[cells.length - 1] += joined + piece.str;
      }
      end = Math.max(end, piece.x + piece.width);
      previous = piece.str;
    }
    const line = cells.map((cell) => cell.replace(/\s+/g, " ").trim()).filter(Boolean).join("\t");
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * The text of a PDF, one array of lines per page. Refuses a password-protected PDF
 * (`encrypted_pdf`), one of more than 30 pages (`too_many_pages`, checked before any text is read),
 * one that can't be opened, such as a truncated file (`unreadable_statement`), and one with no text
 * at all, a scan (`no_text`).
 *
 * The work runs in the caller's process; the 5 MB and 30-page limits are what bound it.
 */
export async function extractPdfText(bytes: Uint8Array): Promise<string[][]> {
  let document: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    // pdf.js may take over the buffer it is given, and the caller's bytes aren't ours to detach.
    // `verbosity: 0` (errors only) keeps pdf.js from logging warnings about the file to the console.
    document = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  } catch (error) {
    // Only the error's class is looked at; its message can quote the file.
    if (error instanceof Error && error.name === "PasswordException") throw new ImportError("encrypted_pdf");
    throw new ImportError("unreadable_statement");
  }

  try {
    if (document.numPages > IMPORT_MAX_PDF_PAGES) throw new ImportError("too_many_pages");
    const { items } = await extractTextItems(document);
    const pages = items.map(linesOf);
    if (pages.every((lines) => lines.length === 0)) throw new ImportError("no_text");
    return pages;
  } catch (error) {
    if (error instanceof ImportError) throw error;
    if (error instanceof Error && error.name === "PasswordException") throw new ImportError("encrypted_pdf");
    throw new ImportError("unreadable_statement");
  } finally {
    await document.loadingTask.destroy().catch(() => {});
  }
}
