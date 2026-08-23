import "server-only";

import { strToU8, zipSync } from "fflate";

import { CATEGORY_LABELS, type Expense } from "@/lib/types";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function textCell(reference: string, value: string, style = 0) {
  return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(reference: string, value: number) {
  return `<c r="${reference}" s="1"><v>${value.toFixed(2)}</v></c>`;
}

export function buildExpenseWorkbook(expenses: Expense[], currency: string) {
  const headers = ["Date", "Description", "Category", `Amount (${currency})`, "Notes"];
  const rows = [
    `<row r="1" ht="24" customHeight="1">${headers
      .map((header, index) => textCell(`${String.fromCharCode(65 + index)}1`, header, 2))
      .join("")}</row>`,
    ...expenses.map((expense, index) => {
      const row = index + 2;
      return `<row r="${row}">${textCell(`A${row}`, expense.expenseDate)}${textCell(`B${row}`, expense.description)}${textCell(`C${row}`, CATEGORY_LABELS[expense.category])}${numberCell(`D${row}`, expense.amount)}${textCell(`E${row}`, expense.notes ?? "")}</row>`;
    }),
  ];

  if (expenses.length) {
    const totalRow = expenses.length + 2;
    const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    rows.push(
      `<row r="${totalRow}">${textCell(`B${totalRow}`, "Total", 3)}<c r="D${totalRow}" s="3"><f>SUM(D2:D${totalRow - 1})</f><v>${total.toFixed(2)}</v></c></row>`,
    );
  }

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="2" width="32" customWidth="1"/><col min="3" max="3" width="20" customWidth="1"/><col min="4" max="4" width="18" customWidth="1"/><col min="5" max="5" width="42" customWidth="1"/></cols>
  <sheetData>${rows.join("")}</sheetData>
  <autoFilter ref="A1:E${Math.max(expenses.length + 1, 1)}"/>
</worksheet>`;

  const files = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Expenses" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1D4ED8"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="4" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/></cellXfs></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(worksheet),
  };

  return zipSync(files, { level: 6 });
}
