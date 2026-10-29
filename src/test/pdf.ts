/**
 * A minimal PDF writer for tests (docs/statement-import-plan.md, task I12): builds a small text PDF
 * from lines, so no binary fixture has to be committed. Every page uses the built-in Helvetica at
 * 10 pt, and text is limited to Latin-1. It is for tests only; nothing in the app imports it.
 */

/** A line is one string, or the cells of a table row, each placed in its own column. */
export type PdfLine = string | readonly string[];
export type PdfPage = readonly PdfLine[];

export type TextPdfOptions = {
  /** Distance between the left edges of the columns of a row, in points. Default 200. */
  columnWidth?: number;
  /** Adds a password to the document, so a reader has to ask for it. */
  encrypted?: boolean;
  /** Pages that draw an image and no text, like a scan. */
  imageOnly?: boolean;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const LEADING = 16;

function escapeText(text: string): string {
  return text.replace(/[\\()]/g, (character) => `\\${character}`);
}

function pageContent(lines: PdfPage, columnWidth: number, imageOnly: boolean): string {
  if (imageOnly) return `q 200 0 0 200 ${MARGIN} ${MARGIN} cm\nBI /W 1 /H 1 /CS /G /BPC 8 ID \u0080\nEI Q\n`;
  const commands = lines.flatMap((line, index) => {
    const cells = typeof line === "string" ? [line] : line;
    const y = PAGE_HEIGHT - MARGIN - index * LEADING;
    return cells.map(
      (cell, column) => `BT /F1 10 Tf ${MARGIN + column * columnWidth} ${y} Td (${escapeText(cell)}) Tj ET`,
    );
  });
  return `${commands.join("\n")}\n`;
}

/** The bytes of a PDF with one page for each entry of `pages`. */
export function buildTextPdf(pages: readonly PdfPage[], options: TextPdfOptions = {}): Uint8Array<ArrayBuffer> {
  const { columnWidth = 200, encrypted = false, imageOnly = false } = options;
  const objects: string[] = [];
  // Object numbers: 1 catalog, 2 page tree, 3 font, 4 the encryption dictionary (always numbered,
  // used only when asked), then a page and its content stream for each page.
  const firstPage = 5;
  const kids = pages.map((_, index) => `${firstPage + index * 2} 0 R`).join(" ");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push(
    `<< /Filter /Standard /V 1 /R 2 /P -4 /O <${"ab".repeat(32)}> /U <${"cd".repeat(32)}> >>`,
  );
  pages.forEach((lines, index) => {
    const content = pageContent(lines, columnWidth, imageOnly);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${firstPage + index * 2 + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  });

  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  const trailer = `/Size ${objects.length + 1} /Root 1 0 R${
    encrypted ? ` /Encrypt 4 0 R /ID [<${"01".repeat(16)}> <${"01".repeat(16)}>]` : ""
  }`;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< ${trailer} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}
