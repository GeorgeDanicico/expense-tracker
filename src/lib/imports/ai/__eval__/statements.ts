import type { ExpenseCategory, ExpenseSubtype } from "@/lib/expenses/categories";
import type { ReaderAnswer } from "@/lib/imports/ai/prompts";
import type { Expected, ExpectedParser, ExpectedRow } from "@/lib/imports/ai/__eval__/types";
import type { ImportSourceKind } from "@/lib/imports/types";
import { buildTextPdf, type PdfLine } from "@/test/pdf";

/**
 * The synthetic statements of the eval (docs/statement-import-plan.md, I19), written as data and
 * rendered to text by code, so each comes with the answer it should get. Nothing here is real:
 * the names are invented (Ion Exemplu, Maria Test), the IBANs are `RO00FAKE…`, and the amounts and
 * dates are made up. `generate.ts` writes the rendered files to `fixtures/`; `eval.test.ts` checks
 * that the files on disk are what this code produces.
 *
 * Each statement is one shape the reader must cope with: English and Romanian headers, comma and
 * dot decimals, CSV and PDF text, a transaction over several lines, foreign-currency rows, refunds
 * and incoming payments, printed totals, and dates printed without a year. Renderers record, for
 * every transaction, the line numbers it is written on and the date and amount exactly as printed,
 * which is what the model is asked for, so that "the answer a perfect model gives" is built, never
 * typed. A wrong line number would make the statement fail verification, and the test that runs
 * every synthetic statement through the real checks catches it.
 *
 * PDFs are limited to Latin-1 (`src/test/pdf.ts`), so no ă, ș or ț in them; the CSVs are UTF-8.
 * Descriptions in a four-column PDF stay under about 24 characters, so a column never runs into
 * the next one.
 */

// ---------------------------------------------------------------------------------------------
// Transactions

export type Txn = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** "45.20". */
  amount: string;
  currency: string;
  direction: "debit" | "credit";
  /** The description as the bank prints it. */
  raw: string;
  /** Further lines of the description, for a transaction written on several lines. */
  more?: string[];
  /** The clean name a good reading gives. Every word of it must be in `raw` or `more`. */
  merchant: string;
  category: ExpenseCategory;
  subtype: ExpenseSubtype | null;
};

type TxnOptions = { subtype?: ExpenseSubtype; more?: string[]; currency?: string };

function txn(direction: Txn["direction"], date: string, amount: string, raw: string, merchant: string, category: ExpenseCategory, options: TxnOptions = {}): Txn {
  return { date, amount, currency: options.currency ?? "RON", direction, raw, more: options.more, merchant, category, subtype: options.subtype ?? null };
}
const debit = (date: string, amount: string, raw: string, merchant: string, category: ExpenseCategory, options?: TxnOptions) =>
  txn("debit", date, amount, raw, merchant, category, options);
const credit = (date: string, amount: string, raw: string, merchant: string, category: ExpenseCategory, options?: TxnOptions) =>
  txn("credit", date, amount, raw, merchant, category, options);

const cents = (amount: string) => Math.round(Number(amount) * 100);

// ---------------------------------------------------------------------------------------------
// Printing

type Style = {
  date: "iso" | "dmy-dot" | "dmy-slash" | "dm-dot";
  decimal: "." | ",";
  thousands: "" | "," | ".";
};

function printDate(iso: string, style: Style["date"]): string {
  const [year, month, day] = iso.split("-");
  if (style === "iso") return iso;
  if (style === "dmy-dot") return `${day}.${month}.${year}`;
  if (style === "dmy-slash") return `${day}/${month}/${year}`;
  return `${day}.${month}`;
}

function printMoney(totalCents: number, style: Style): string {
  const whole = Math.floor(totalCents / 100);
  const fraction = String(totalCents % 100).padStart(2, "0");
  const integer = style.thousands ? String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, style.thousands) : String(whole);
  return `${integer}${style.decimal}${fraction}`;
}

/** Fields that contain a delimiter, a quote or a line break are quoted. */
function quote(field: string, delimiter: string): string {
  return field.includes(delimiter) || /["\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

// ---------------------------------------------------------------------------------------------
// Rendering: numbered lines, and where each transaction sits in them

/** The lines of a statement. A line's number is its position among the non-empty lines, which is how the reader numbers them. */
class Lines {
  readonly pages: string[][] = [[]];
  private count = 0;

  /** Adds a line and returns its number (from 1). */
  push(line: string): number {
    if (line.trim() === "") throw new Error("A blank line would not be numbered.");
    this.pages[this.pages.length - 1].push(line);
    this.count += 1;
    return this.count;
  }

  /** Starts a new page of a PDF. */
  page() {
    this.pages.push([]);
  }

  get all(): string[] {
    return this.pages.flat();
  }
}

/** Where one transaction is written: the lines it spans and its date and amount exactly as printed. */
type Cite = { lines: number[]; d: string; a: string; c: string | null };

type Built = {
  lines: Lines;
  /** One per transaction, in order. */
  cites: Cite[];
  /** The printed total of money out, and the line it is on. */
  total: { text: string; line: number } | null;
  /** The currency the statement states, as the model should report it. */
  currency: string | null;
  /** Distance between a PDF table's columns, in points. */
  columnWidth?: number;
  /** Line ending of a CSV. */
  eol?: "\n" | "\r\n";
};

type SyntheticStatement = {
  id: string;
  description: string;
  kind: ImportSourceKind;
  /** What the generic CSV parser does with it (checked by the tests). */
  parser: ExpectedParser;
  knownGap?: { reason: string; note: string };
  txns: Txn[];
  build(txns: Txn[]): Built;
};

function sumOfDebits(txns: readonly Txn[], currency = "RON"): number {
  return txns.filter((t) => t.direction === "debit" && t.currency === currency).reduce((sum, t) => sum + cents(t.amount), 0);
}

/** The running balance after each transaction, from an opening balance in cents. Only the statement's own currency moves it. */
function balances(txns: readonly Txn[], opening: number): number[] {
  let balance = opening;
  return txns.map((t) => {
    if (t.currency === "RON") balance += t.direction === "credit" ? cents(t.amount) : -cents(t.amount);
    return balance;
  });
}

// ---------------------------------------------------------------------------------------------
// The hand-written statements

/** English headers, ISO dates, dot decimals, one signed amount, a currency column. A parser reads it. */
function csvEnIsoSigned(): SyntheticStatement {
  const txns = [
    debit("2026-09-01", "45.20", "POS 4411 LIDL CLUJ RO", "Lidl Cluj", "groceries"),
    debit("2026-09-02", "12.50", "STARBUCKS 2201 CLUJ", "Starbucks", "entertainment"),
    debit("2026-09-03", "189.99", "EMAG.RO 8812", "eMAG", "shopping"),
    debit("2026-09-04", "250.00", "OMV 1642 SATU MARE", "OMV 1642 Satu Mare", "car", { subtype: "car_fuel" }),
    credit("2026-09-05", "4500.00", "SALARIU EXEMPLU SRL", "Salariu Exemplu", "other"),
    debit("2026-09-08", "89.90", "FARMACIA CATENA 331", "Farmacia Catena", "health"),
    debit("2026-09-09", "39.99", "NETFLIX.COM", "Netflix", "entertainment"),
    debit("2026-09-10", "310.45", "ENEL ENERGIE", "Enel Energie", "utilities"),
    credit("2026-09-12", "45.20", "RAMBURSARE LIDL CLUJ", "Lidl Cluj", "groceries"),
    debit("2026-09-15", "75.00", "BOLT.EU/O/2610", "Bolt", "transport"),
    debit("2026-09-20", "540.00", "BOOKING.COM, 1234567", "Booking.com", "travel"),
    debit("2026-09-22", "15.00", "COMISION ADMINISTRARE CONT", "Comision Administrare", "other"),
    debit("2026-09-25", "300.00", "RETRAGERE NUMERAR ATM", "Retragere Numerar ATM", "other"),
    debit("2026-09-28", "64.30", "VULCANIZARE FAST TYRES", "Vulcanizare Fast Tyres", "car", { subtype: "car_maintenance" }),
  ];
  return {
    id: "csv-en-iso-signed",
    description: "English headers, ISO dates, dot decimals, one signed amount column, a currency column, a refund and a salary.",
    kind: "csv",
    parser: "ok",
    txns,
    build(rows) {
      const style: Style = { date: "iso", decimal: ".", thousands: "" };
      const lines = new Lines();
      lines.push("Date,Description,Amount,Currency");
      const cites = rows.map((t): Cite => {
        const d = printDate(t.date, style.date);
        const a = `${t.direction === "debit" ? "-" : "+"}${printMoney(cents(t.amount), style)}`;
        const line = lines.push(`${d},${quote(t.raw, ",")},${a},${t.currency}`);
        return { lines: [line], d, a, c: t.currency };
      });
      return { lines, cites, total: null, currency: "RON" };
    },
  };
}

/** English headers, semicolons, day-first dates, comma decimals, a debit and a credit column, a running balance. A parser reads it. */
function csvEnDebitCredit(): SyntheticStatement {
  const txns = [
    debit("2026-09-01", "234.56", "CARD PAYMENT KAUFLAND ARENA 2210", "Kaufland", "groceries"),
    debit("2026-09-02", "14.90", "CARD PAYMENT MCDONALDS 0451", "McDonalds", "entertainment"),
    debit("2026-09-03", "1500.00", "STANDING ORDER CHIRIE APARTAMENT", "Chirie Apartament", "housing"),
    credit("2026-09-05", "4800.00", "SALARY EXEMPLU SRL", "Salary Exemplu", "other"),
    debit("2026-09-06", "59.00", "DIRECT DEBIT DIGI ROMANIA SA", "Digi", "utilities"),
    debit("2026-09-08", "120.00", "CARD PAYMENT DR MAX 1045", "Dr Max", "health"),
    debit("2026-09-10", "33.40", "CARD PAYMENT UBER *TRIP", "Uber", "transport"),
    credit("2026-09-11", "120.00", "REFUND DR MAX 1045", "Dr Max", "health"),
    debit("2026-09-14", "450.00", "CARD PAYMENT ZARA RO 0123", "Zara", "shopping"),
    debit("2026-09-18", "25.00", "CARD PAYMENT PARCARE ZONA CENTRU", "Parcare Centru", "car", { subtype: "car_maintenance" }),
    debit("2026-09-21", "89.99", "CARD PAYMENT DECATHLON CLUJ", "Decathlon", "shopping"),
    debit("2026-09-27", "399.00", "CARD PAYMENT UDEMY U1234", "Udemy", "education"),
  ];
  return {
    id: "csv-en-debit-credit-comma",
    description: "English headers, semicolons, DD.MM.YYYY dates, comma decimals with dot thousands, separate debit and credit columns, a running balance.",
    kind: "csv",
    parser: "ok",
    txns,
    build(rows) {
      const style: Style = { date: "dmy-dot", decimal: ",", thousands: "." };
      const lines = new Lines();
      lines.push("Date;Description;Debit;Credit;Balance");
      const after = balances(rows, 600000);
      const cites = rows.map((t, index): Cite => {
        const d = printDate(t.date, style.date);
        const a = printMoney(cents(t.amount), style);
        const money = `${a} RON`;
        const line = lines.push(`${d};${t.raw};${t.direction === "debit" ? money : ""};${t.direction === "credit" ? money : ""};${printMoney(after[index], style)}`);
        return { lines: [line], d, a, c: "RON" };
      });
      return { lines, cites, total: null, currency: "RON" };
    },
  };
}

/** Romanian headers, CRLF, quoted descriptions over two or three lines, a refund, and printed totals of debit and credit. No parser claims it. */
function csvRoMultiline(): SyntheticStatement {
  const txns = [
    debit("2026-09-02", "45.20", "Plata POS Lidl Cluj", "Lidl Cluj", "groceries", { more: ["Card 4411 Terminal 0042"] }),
    debit("2026-09-03", "18.50", "Plata POS Cafeneaua Exemplu", "Cafeneaua Exemplu", "entertainment", { more: ["Cluj-Napoca RO"] }),
    credit("2026-09-05", "5200.00", "Incasare salariu Exemplu SRL", "Salariu Exemplu", "other", { more: ["Referinta 20260905"] }),
    debit("2026-09-07", "312.75", "Plata factura Enel Energie", "Enel Energie", "utilities", { more: ["Contract 1234567", "Factura septembrie"] }),
    debit("2026-09-09", "255.00", "Plata POS Rompetrol", "Rompetrol", "car", { subtype: "car_fuel", more: ["Statia 0412 Cluj"] }),
    debit("2026-09-12", "1500.00", "Plata chirie apartament", "Chirie Apartament", "housing"),
    debit("2026-09-13", "120.00", "Transfer catre Maria Test", "Maria Test", "other"),
    credit("2026-09-15", "45.20", "Rambursare Lidl Cluj", "Lidl Cluj", "groceries"),
    debit("2026-09-18", "76.40", "Plata POS Farmacia Catena 331", "Farmacia Catena", "health"),
    debit("2026-09-22", "15.00", "Comision administrare cont", "Comision Administrare", "other"),
    debit("2026-09-26", "289.90", "Plata POS Kaufland Cluj", "Kaufland Cluj", "groceries", { more: ["Card 4411 Terminal 0107"] }),
  ];
  return {
    id: "csv-ro-multiline",
    description: "Romanian headers and descriptions with diacritics, CRLF, descriptions in quoted cells over two or three lines, a refund, a salary, and printed totals of debit and credit.",
    kind: "csv",
    parser: "none",
    txns,
    build(rows) {
      const style: Style = { date: "dmy-dot", decimal: ",", thousands: "." };
      const lines = new Lines();
      lines.push("Extras de cont lunar;Moneda: RON;;;");
      lines.push("Titular cont;Ion Exemplu;;;");
      lines.push("IBAN;RO00FAKE0000000000000001;;;");
      lines.push("Perioada;01.09.2026 - 30.09.2026;;;");
      lines.push("Data;Detalii tranzacție;Debit;Credit;Sold");
      const after = balances(rows, 450000);
      const cites = rows.map((t, index): Cite => {
        const d = printDate(t.date, style.date);
        const a = printMoney(cents(t.amount), style);
        const tail = `${t.direction === "debit" ? a : ""};${t.direction === "credit" ? a : ""};${printMoney(after[index], style)}`;
        const parts = [t.raw, ...(t.more ?? [])];
        if (parts.length === 1) {
          const line = lines.push(`${d};${t.raw};${tail}`);
          return { lines: [line], d, a, c: null };
        }
        // A quoted cell over several lines: the date is on the first, the amounts after the closing quote on the last.
        const numbers = [lines.push(`${d};"${parts[0]}`)];
        parts.slice(1, -1).forEach((part) => numbers.push(lines.push(part)));
        numbers.push(lines.push(`${parts[parts.length - 1]}";${tail}`));
        return { lines: numbers, d, a, c: null };
      });
      const debits = printMoney(sumOfDebits(rows), style);
      const credits = printMoney(rows.filter((t) => t.direction === "credit").reduce((sum, t) => sum + cents(t.amount), 0), style);
      const totalLine = lines.push(`Total rulaje;;${debits};${credits};`);
      return { lines, cites, total: { text: debits, line: totalLine }, currency: "RON", eol: "\r\n" };
    },
  };
}

/** Romanian headers, a per-row currency column, signed amounts with dot thousands, rows in EUR and USD, a refund in EUR and a conversion fee. */
function csvRoForeign(): SyntheticStatement {
  const txns = [
    debit("2026-09-01", "45.20", "Lidl Cluj", "Lidl Cluj", "groceries"),
    debit("2026-09-03", "540.00", "Booking.com 1234567", "Booking.com", "travel", { currency: "EUR" }),
    debit("2026-09-04", "19.99", "Udemy U1234", "Udemy", "education", { currency: "USD" }),
    credit("2026-09-06", "5200.00", "Salariu Exemplu SRL", "Salariu Exemplu", "other"),
    debit("2026-09-10", "1432.10", "Wizz Air", "Wizz Air", "travel"),
    debit("2026-09-14", "87.45", "Amazon EU Exemplu", "Amazon EU Exemplu", "shopping", { currency: "EUR" }),
    credit("2026-09-19", "120.00", "Rambursare Booking.com", "Booking.com", "travel", { currency: "EUR" }),
    debit("2026-09-21", "3.50", "Comision conversie valutara", "Comision Conversie Valutara", "other"),
    debit("2026-09-28", "59.00", "Digi Romania", "Digi", "utilities"),
  ];
  return {
    id: "csv-ro-foreign",
    description: "Romanian headers, a currency column per row, signed amounts, dot thousands, rows in EUR and USD in a RON statement, a refund in EUR.",
    kind: "csv",
    parser: "none",
    txns,
    build(rows) {
      const style: Style = { date: "dmy-dot", decimal: ",", thousands: "." };
      const lines = new Lines();
      lines.push("Cont curent RON;Extras septembrie 2026;;");
      lines.push("Data;Beneficiar;Suma;Valuta");
      const cites = rows.map((t): Cite => {
        const d = printDate(t.date, style.date);
        const a = `${t.direction === "debit" ? "-" : "+"}${printMoney(cents(t.amount), style)}`;
        const line = lines.push(`${d};${t.raw};${a};${t.currency}`);
        return { lines: [line], d, a, c: t.currency };
      });
      return { lines, cites, total: null, currency: "RON" };
    },
  };
}

/**
 * A comma-separated file whose descriptions are not quoted, where a store number of up to three
 * digits sits right before an amount that starts with three digits ("Mega Image 118,118.40").
 * Read as text, "118,118.40" is one number with a thousands group; verification matches amounts in
 * a CSV field by field (the comma is the delimiter, so the store number and the amount are two
 * fields) and accepts the model's right answer. Once a known gap of `verify.ts`; fixed in I20.
 */
function csvRoCommaDigitsBeforeAmount(): SyntheticStatement {
  const txns = [
    debit("2026-09-02", "45.20", "Plata POS Lidl Cluj", "Lidl Cluj", "groceries"),
    debit("2026-09-03", "118.40", "Plata POS Mega Image 118", "Mega Image", "groceries"),
    credit("2026-09-05", "5200.00", "Incasare salariu Exemplu SRL", "Salariu Exemplu", "other"),
    debit("2026-09-08", "255.00", "Plata POS Rompetrol", "Rompetrol", "car", { subtype: "car_fuel" }),
    debit("2026-09-12", "76.40", "Plata POS Farmacia Catena", "Farmacia Catena", "health"),
    debit("2026-09-15", "59.00", "Plata abonament Digi Romania", "Digi", "utilities"),
    debit("2026-09-20", "33.40", "Plata Bolt", "Bolt", "transport"),
    debit("2026-09-25", "39.99", "Plata Netflix", "Netflix", "entertainment"),
  ];
  return {
    id: "csv-ro-comma-digits-before-amount",
    description:
      "Romanian headers, comma-separated, descriptions not quoted, separate debit and credit columns with dot decimals; one description ends in a store number that runs into the amount (Mega Image 118,118.40).",
    kind: "csv",
    parser: "none",
    txns,
    build(rows) {
      const style: Style = { date: "iso", decimal: ".", thousands: "" };
      const lines = new Lines();
      lines.push("Extras de cont RON,,,");
      lines.push("Data,Detalii,Debit,Credit");
      const cites = rows.map((t): Cite => {
        const d = printDate(t.date, style.date);
        const a = printMoney(cents(t.amount), style);
        const line = lines.push(`${d},${t.raw},${t.direction === "debit" ? a : ""},${t.direction === "credit" ? a : ""}`);
        return { lines: [line], d, a, c: null };
      });
      return { lines, cites, total: null, currency: "RON" };
    },
  };
}

/**
 * English headers a parser recognises, but the currency is stated only above the table. The
 * generic parser claims the file and then refuses it (no currency on the rows); with AI on, the
 * pipeline hands such a file to the model (I20), which reads it fine.
 */
function csvEnCurrencyInPreamble(): SyntheticStatement {
  const txns = [
    debit("2026-09-02", "45.20", "LIDL CLUJ", "Lidl Cluj", "groceries"),
    debit("2026-09-04", "210.30", "ENGIE GAZ", "Engie Gaz", "utilities"),
    debit("2026-09-05", "56.00", "CINEMA CITY EXEMPLU", "Cinema City", "entertainment"),
    credit("2026-09-07", "3200.00", "SALARY EXEMPLU SRL", "Salary Exemplu", "other"),
    debit("2026-09-11", "89.00", "CFR CALATORI", "CFR Calatori", "transport"),
    debit("2026-09-13", "330.00", "AUTODOC PIESE AUTO", "Autodoc", "car", { subtype: "car_repairs" }),
    debit("2026-09-17", "40.00", "SPALATORIE AQUA EXPRES", "Spalatorie Aqua", "car", { subtype: "car_maintenance" }),
    debit("2026-09-19", "118.40", "MEGA IMAGE CLUJ", "Mega Image", "groceries"),
    debit("2026-09-24", "95.00", "WORLD CLASS GYM", "World Class", "health"),
  ];
  return {
    id: "csv-en-currency-in-preamble",
    description:
      "English headers a parser recognises, a preamble with a fake holder and IBAN, the currency stated only above the table, a printed total of money out. The parser claims it and then refuses it.",
    kind: "csv",
    parser: "refused",
    txns,
    build(rows) {
      const style: Style = { date: "iso", decimal: ".", thousands: "" };
      const lines = new Lines();
      lines.push("Account statement");
      lines.push("Holder,Ion Exemplu");
      lines.push("IBAN,RO00FAKE0000000000000002");
      lines.push("Currency,RON");
      lines.push("Period,2026-09-01 to 2026-09-30");
      lines.push("Date,Description,Money out,Money in");
      const cites = rows.map((t): Cite => {
        const d = printDate(t.date, style.date);
        const a = printMoney(cents(t.amount), style);
        const line = lines.push(`${d},${t.raw},${t.direction === "debit" ? a : ""},${t.direction === "credit" ? a : ""}`);
        return { lines: [line], d, a, c: null };
      });
      const total = printMoney(sumOfDebits(rows), style);
      const totalLine = lines.push(`Total money out,,${total},`);
      return { lines, cites, total: { text: total, line: totalLine }, currency: "RON" };
    },
  };
}

/** An English PDF table over two pages: ISO dates, dot decimals with comma thousands, signed amounts, a running balance, descriptions that wrap, a printed total. */
function pdfEnTwoPages(): SyntheticStatement {
  const txns = [
    debit("2026-09-01", "45.20", "POS LIDL CLUJ", "Lidl Cluj", "groceries"),
    debit("2026-09-02", "12.50", "STARBUCKS CLUJ", "Starbucks", "entertainment"),
    debit("2026-09-03", "1500.00", "CHIRIE APARTAMENT", "Chirie Apartament", "housing"),
    credit("2026-09-05", "4500.00", "SALARY EXEMPLU SRL", "Salary Exemplu", "other"),
    debit("2026-09-06", "59.00", "DIGI ROMANIA SA", "Digi", "utilities"),
    debit("2026-09-08", "120.00", "TRANSFER CATRE", "Maria Test", "other", { more: ["MARIA TEST"] }),
    debit("2026-09-09", "319.90", "EMAG.RO 8812", "eMAG", "shopping"),
    debit("2026-09-11", "33.40", "UBER *TRIP", "Uber", "transport"),
    debit("2026-09-12", "1234.56", "ZARA RO 0123", "Zara", "shopping"),
    credit("2026-09-14", "89.00", "REFUND FARMACIA", "Farmacia Catena", "health", { more: ["CATENA 331"] }),
    debit("2026-09-16", "245.00", "ROMPETROL 0412", "Rompetrol", "car", { subtype: "car_fuel" }),
    debit("2026-09-18", "39.99", "NETFLIX.COM", "Netflix", "entertainment"),
    debit("2026-09-21", "86.30", "KAUFLAND ARENA 2210", "Kaufland", "groceries"),
    debit("2026-09-24", "15.00", "COMISION ADMINISTRARE", "Comision Administrare", "other"),
    debit("2026-09-26", "180.00", "CLINICA EXEMPLU", "Clinica Exemplu", "health"),
    debit("2026-09-29", "64.30", "VULCANIZARE FAST", "Vulcanizare Fast Tyres", "car", { subtype: "car_maintenance", more: ["TYRES"] }),
  ];
  return {
    id: "pdf-en-two-pages",
    description:
      "English PDF table over two pages: ISO dates, dot decimals with comma thousands, signed amounts, a running balance, descriptions that continue on a second line, page footers, a printed total of money out.",
    kind: "pdf",
    parser: "none",
    txns,
    build(rows) {
      const style: Style = { date: "iso", decimal: ".", thousands: "," };
      const lines = new Lines();
      lines.push("Example Bank - Account statement");
      lines.push("Account holder: Ion Exemplu");
      lines.push("IBAN RO00FAKE0000000000000003");
      lines.push("Statement period 2026-09-01 to 2026-09-30");
      lines.push("Currency: RON");
      lines.push("Date\tDescription\tAmount\tBalance");
      lines.push(`Opening balance\t${printMoney(500000, style)}`);
      const after = balances(rows, 500000);
      const cites = rows.map((t, index): Cite => {
        if (index === 8) {
          lines.push("Page 1 of 2");
          lines.page();
          lines.push("Date\tDescription\tAmount\tBalance");
        }
        const d = printDate(t.date, style.date);
        const a = `${t.direction === "debit" ? "-" : "+"}${printMoney(cents(t.amount), style)}`;
        const numbers = [lines.push(`${d}\t${t.raw}\t${a}\t${printMoney(after[index], style)}`)];
        (t.more ?? []).forEach((part) => numbers.push(lines.push(part)));
        return { lines: numbers, d, a, c: null };
      });
      lines.push(`Closing balance\t${printMoney(after[after.length - 1], style)}`);
      const total = printMoney(sumOfDebits(rows), style);
      const totalLine = lines.push(`Total money out\t${total}`);
      lines.push("Page 2 of 2");
      return { lines, cites, total: { text: total, line: totalLine }, currency: "RON", columnWidth: 135 };
    },
  };
}

/** A Romanian PDF table: DD.MM.YYYY dates, comma decimals with dot thousands, the currency printed after each signed amount, a printed total. */
function pdfRoTable(): SyntheticStatement {
  const txns = [
    debit("2026-09-01", "45.20", "PLATA POS LIDL CLUJ", "Lidl Cluj", "groceries"),
    debit("2026-09-02", "1500.00", "PLATA CHIRIE", "Chirie", "housing"),
    credit("2026-09-05", "5200.00", "INCASARE SALARIU", "Salariu", "other", { more: ["EXEMPLU SRL"] }),
    debit("2026-09-07", "312.75", "FACTURA ENEL ENERGIE", "Enel Energie", "utilities"),
    debit("2026-09-09", "255.00", "PLATA POS ROMPETROL", "Rompetrol", "car", { subtype: "car_fuel" }),
    debit("2026-09-10", "28.00", "PLATA POS BISTRO TEST", "Bistro Test", "entertainment"),
    debit("2026-09-13", "76.40", "FARMACIA DR MAX 1045", "Dr Max", "health"),
    credit("2026-09-15", "45.20", "RAMBURSARE LIDL CLUJ", "Lidl Cluj", "groceries"),
    debit("2026-09-17", "2480.00", "PLATA WIZZ AIR", "Wizz Air", "travel"),
    debit("2026-09-20", "199.00", "PLATA POS DECATHLON", "Decathlon", "shopping"),
    debit("2026-09-23", "35.00", "PARCARE ZONA CENTRU", "Parcare Centru", "car", { subtype: "car_maintenance" }),
    debit("2026-09-27", "15.00", "COMISION CONT", "Comision Cont", "other"),
  ];
  return {
    id: "pdf-ro-table",
    description: "Romanian PDF table, DD.MM.YYYY dates, comma decimals with dot thousands, the currency printed after every signed amount, a running balance, a printed total of debits.",
    kind: "pdf",
    parser: "none",
    txns,
    build(rows) {
      const style: Style = { date: "dmy-dot", decimal: ",", thousands: "." };
      const lines = new Lines();
      lines.push("Banca Exemplu - Extras de cont");
      lines.push("Titular: Maria Test");
      lines.push("Cont RO00FAKE0000000000000004");
      lines.push("Perioada 01.09.2026 - 30.09.2026");
      lines.push("Moneda: RON");
      lines.push("Data\tDescriere\tSuma\tSold");
      lines.push(`Sold initial\t${printMoney(800000, style)} RON`);
      const after = balances(rows, 800000);
      const cites = rows.map((t, index): Cite => {
        const d = printDate(t.date, style.date);
        const a = `${t.direction === "debit" ? "-" : "+"}${printMoney(cents(t.amount), style)}`;
        const numbers = [lines.push(`${d}\t${t.raw}\t${a} RON\t${printMoney(after[index], style)} RON`)];
        (t.more ?? []).forEach((part) => numbers.push(lines.push(part)));
        return { lines: numbers, d, a, c: "RON" };
      });
      lines.push(`Sold final\t${printMoney(after[after.length - 1], style)} RON`);
      const total = printMoney(sumOfDebits(rows), style);
      const totalLine = lines.push(`Total debite\t${total} RON`);
      return { lines, cites, total: { text: total, line: totalLine }, currency: "RON", columnWidth: 135 };
    },
  };
}

/**
 * An English card statement where every transaction takes two or three lines: the date and the
 * amount, then the merchant, then a reference. Purchases are positive and money in is marked CR,
 * and two rows are in EUR.
 */
function pdfCardMultiline(): SyntheticStatement {
  const txns = [
    debit("2026-09-03", "45.20", "LIDL CLUJ NAPOCA RO", "Lidl Cluj Napoca", "groceries"),
    debit("2026-09-05", "32.50", "AIRBNB EXEMPLU", "Airbnb Exemplu", "travel", { currency: "EUR" }),
    debit("2026-09-07", "18.90", "CAFENEAUA DIN PIATA", "Cafeneaua Din Piata", "entertainment"),
    credit("2026-09-09", "500.00", "PAYMENT RECEIVED - THANK YOU", "Payment Received", "other"),
    debit("2026-09-12", "210.00", "MOL STATIA 0877", "Mol", "car", { subtype: "car_fuel" }),
    credit("2026-09-14", "18.00", "REFUND CAFENEAUA DIN PIATA", "Cafeneaua Din Piata", "entertainment"),
    debit("2026-09-18", "14.99", "SPOTIFY P12345", "Spotify", "entertainment"),
    debit("2026-09-21", "64.10", "STEAM PURCHASE EXEMPLU", "Steam", "entertainment", { currency: "EUR" }),
    debit("2026-09-25", "129.00", "ZARA RO 0123", "Zara", "shopping"),
  ];
  return {
    id: "pdf-card-multiline",
    description:
      "English card statement PDF: each transaction on two or three lines (date and amount, merchant, reference), purchases positive, money in marked CR, two EUR rows, DD/MM/YYYY dates, dot decimals.",
    kind: "pdf",
    parser: "none",
    txns,
    build(rows) {
      const style: Style = { date: "dmy-slash", decimal: ".", thousands: "," };
      const lines = new Lines();
      lines.push("Example Card Services");
      lines.push("Card statement for Ion Exemplu");
      lines.push("Card number 4111 1111 1111 1111");
      lines.push("Statement date 30/09/2026");
      lines.push("Account currency RON");
      lines.push("Date\tAmount");
      const cites = rows.map((t, index): Cite => {
        if (index === 5) {
          lines.push("Continued on the next page");
          lines.page();
          lines.push("Date\tAmount");
        }
        const d = printDate(t.date, style.date);
        const a = printMoney(cents(t.amount), style);
        const printed = t.currency === "RON" ? a : `${t.currency} ${a}`;
        const first = lines.push(`${d}\t${printed}${t.direction === "credit" ? " CR" : ""}`);
        const second = lines.push(t.raw);
        lines.push(t.currency === "RON" ? `Ref ${884200 + index} Card ending 1111` : `Foreign transaction ref ${884200 + index}`);
        return { lines: [first, second], d, a, c: t.currency === "RON" ? null : t.currency };
      });
      return { lines, cites, total: null, currency: "RON", columnWidth: 135 };
    },
  };
}

/** A Romanian PDF whose rows print the day and month but no year ("12.10"). The year is only in the heading, and code takes it from there (I20). */
function pdfRoNoYear(): SyntheticStatement {
  const txns = [
    debit("2026-10-02", "45.20", "PLATA POS LIDL CLUJ", "Lidl Cluj", "groceries"),
    debit("2026-10-05", "312.75", "FACTURA ENEL ENERGIE", "Enel Energie", "utilities"),
    credit("2026-10-07", "5200.00", "INCASARE SALARIU EXEMPLU SRL", "Salariu Exemplu", "other"),
    debit("2026-10-09", "255.00", "PLATA POS ROMPETROL", "Rompetrol", "car", { subtype: "car_fuel" }),
    debit("2026-10-12", "28.00", "PLATA POS BISTRO TEST", "Bistro Test", "entertainment"),
    debit("2026-10-15", "76.40", "FARMACIA DR MAX 1045", "Dr Max", "health"),
    debit("2026-10-19", "59.00", "ABONAMENT DIGI ROMANIA", "Digi", "utilities"),
    debit("2026-10-28", "199.00", "PLATA POS DECATHLON", "Decathlon", "shopping"),
  ];
  return {
    id: "pdf-ro-no-year",
    description: "Romanian PDF whose rows print the date as day and month only (12.10); the period with its year is in the heading. Comma decimals.",
    kind: "pdf",
    parser: "none",
    txns,
    build(rows) {
      const style: Style = { date: "dm-dot", decimal: ",", thousands: "." };
      const lines = new Lines();
      lines.push("Banca Exemplu - Extras card");
      lines.push("Perioada 01.10.2026 - 31.10.2026");
      lines.push("Moneda: RON");
      lines.push("Data\tDescriere\tSuma");
      const cites = rows.map((t): Cite => {
        const d = printDate(t.date, style.date);
        const a = `${t.direction === "debit" ? "-" : "+"}${printMoney(cents(t.amount), style)}`;
        const line = lines.push(`${d}\t${t.raw}\t${a}`);
        return { lines: [line], d, a, c: null };
      });
      return { lines, cites, total: null, currency: "RON", columnWidth: 180 };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The generated statements: a whole month of an ordinary account, for realistic size and cost

/** A small deterministic generator (mulberry32), so a regenerated fixture is byte for byte the same. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Shop = { raw: string; merchant: string; category: ExpenseCategory; subtype?: ExpenseSubtype; min: number; max: number };

const SHOPS: Shop[] = [
  { raw: "POS LIDL CLUJ 4411", merchant: "Lidl Cluj", category: "groceries", min: 1500, max: 28000 },
  { raw: "POS LIDL BUC 4412", merchant: "Lidl Buc", category: "groceries", min: 1500, max: 24000 },
  { raw: "KAUFLAND CLUJ 2210", merchant: "Kaufland Cluj", category: "groceries", min: 4000, max: 42000 },
  { raw: "MEGA IMAGE 118", merchant: "Mega Image", category: "groceries", min: 800, max: 15000 },
  { raw: "PROFI BRASOV 904", merchant: "Profi", category: "groceries", min: 600, max: 9000 },
  { raw: "BRUTARIA EXEMPLU", merchant: "Brutaria Exemplu", category: "groceries", min: 400, max: 2500 },
  { raw: "STARBUCKS 2201", merchant: "Starbucks", category: "entertainment", min: 1200, max: 3800 },
  { raw: "MCDONALDS 0451", merchant: "McDonalds", category: "entertainment", min: 1800, max: 6500 },
  { raw: "BISTRO TEST 12", merchant: "Bistro Test", category: "entertainment", min: 2500, max: 14000 },
  { raw: "CINEMA CITY EXEMPLU", merchant: "Cinema City", category: "entertainment", min: 3000, max: 9000 },
  { raw: "NETFLIX.COM", merchant: "Netflix", category: "entertainment", min: 3999, max: 3999 },
  { raw: "SPOTIFY P12345", merchant: "Spotify", category: "entertainment", min: 2499, max: 2499 },
  { raw: "DIGI ROMANIA SA", merchant: "Digi", category: "utilities", min: 5900, max: 5900 },
  { raw: "ENEL ENERGIE", merchant: "Enel Energie", category: "utilities", min: 15000, max: 38000 },
  { raw: "APA NOVA TEST", merchant: "Apa Nova", category: "utilities", min: 4000, max: 9000 },
  { raw: "ENGIE GAZ", merchant: "Engie Gaz", category: "utilities", min: 9000, max: 32000 },
  { raw: "FARMACIA CATENA 331", merchant: "Farmacia Catena", category: "health", min: 1500, max: 18000 },
  { raw: "DR MAX 1045", merchant: "Dr Max", category: "health", min: 1200, max: 14000 },
  { raw: "CLINICA EXEMPLU", merchant: "Clinica Exemplu", category: "health", min: 15000, max: 40000 },
  { raw: "WORLD CLASS GYM", merchant: "World Class", category: "health", min: 18000, max: 18000 },
  { raw: "BOLT.EU/O/2610", merchant: "Bolt", category: "transport", min: 1200, max: 5500 },
  { raw: "UBER *TRIP", merchant: "Uber", category: "transport", min: 1500, max: 6000 },
  { raw: "CFR CALATORI", merchant: "CFR Calatori", category: "transport", min: 3000, max: 14000 },
  { raw: "ROMPETROL 0412", merchant: "Rompetrol", category: "car", subtype: "car_fuel", min: 15000, max: 32000 },
  { raw: "MOL STATIA 0877", merchant: "Mol", category: "car", subtype: "car_fuel", min: 12000, max: 30000 },
  { raw: "VULCANIZARE FAST", merchant: "Vulcanizare Fast", category: "car", subtype: "car_maintenance", min: 4000, max: 60000 },
  { raw: "SPALATORIE AQUA", merchant: "Spalatorie Aqua", category: "car", subtype: "car_maintenance", min: 2500, max: 6000 },
  { raw: "PARCARE ZONA CENTRU", merchant: "Parcare Centru", category: "car", subtype: "car_maintenance", min: 500, max: 3000 },
  { raw: "AUTODOC PIESE AUTO", merchant: "Autodoc", category: "car", subtype: "car_repairs", min: 8000, max: 90000 },
  { raw: "EMAG.RO 8812", merchant: "eMAG", category: "shopping", min: 4000, max: 150000 },
  { raw: "ZARA RO 0123", merchant: "Zara", category: "shopping", min: 8000, max: 60000 },
  { raw: "DECATHLON CLUJ", merchant: "Decathlon", category: "shopping", min: 3000, max: 45000 },
  { raw: "UDEMY U1234", merchant: "Udemy", category: "education", min: 2500, max: 9000 },
  { raw: "UNIVERSITATEA EXEMPLU", merchant: "Universitatea Exemplu", category: "education", min: 50000, max: 120000 },
  { raw: "WIZZ AIR", merchant: "Wizz Air", category: "travel", min: 20000, max: 90000 },
  { raw: "HOTEL EXEMPLU", merchant: "Hotel Exemplu", category: "travel", min: 30000, max: 110000 },
  { raw: "RETRAGERE NUMERAR ATM", merchant: "Retragere Numerar ATM", category: "other", min: 10000, max: 50000 },
];

/** An ordinary month: rent, a salary, some refunds, a bank fee and `count` card payments, in date order. */
function ordinaryMonth(seed: number, count: number, year: number, month: number): Txn[] {
  const next = random(seed);
  const day = (index: number) => 1 + Math.floor((index * 28) / count);
  const date = (d: number) => `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const rows: Txn[] = [];
  for (let index = 0; index < count; index += 1) {
    const shop = SHOPS[Math.floor(next() * SHOPS.length)];
    const amount = shop.min + Math.floor(next() * (shop.max - shop.min + 1));
    rows.push(debit(date(day(index)), (amount / 100).toFixed(2), shop.raw, shop.merchant, shop.category, { subtype: shop.subtype }));
  }
  rows.push(debit(date(3), "1500.00", "CHIRIE APARTAMENT", "Chirie Apartament", "housing"));
  rows.push(debit(date(28), "15.00", "COMISION ADMINISTRARE", "Comision Administrare", "other"));
  rows.push(credit(date(5), "5200.00", "SALARIU EXEMPLU SRL", "Salariu Exemplu", "other"));
  rows.push(credit(date(12), "89.40", "RAMBURSARE EMAG.RO", "eMAG", "shopping"));
  rows.push(credit(date(21), "32.00", "RAMBURSARE BOLT.EU", "Bolt", "transport"));
  // Stable by date: Array.prototype.sort keeps the order of equal dates.
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

/** A three-page Romanian PDF of about a hundred and ten rows: signed amounts, a balance, page footers and a printed total. */
function pdfRoLargeMonth(): SyntheticStatement {
  return {
    id: "pdf-ro-large-month",
    description: "Romanian PDF of a whole month (about 110 transactions over three pages): DD.MM.YYYY dates, comma decimals, signed amounts, a running balance, page footers, a printed total. For realistic size and cost.",
    kind: "pdf",
    parser: "none",
    txns: ordinaryMonth(2026, 106, 2026, 9),
    build(rows) {
      const style: Style = { date: "dmy-dot", decimal: ",", thousands: "." };
      const lines = new Lines();
      const perPage = 40;
      const header = "Data\tDescriere\tSuma\tSold";
      lines.push("Banca Exemplu - Extras de cont");
      lines.push("Titular: Ion Exemplu");
      lines.push("Cont RO00FAKE0000000000000005");
      lines.push("Perioada 01.09.2026 - 30.09.2026");
      lines.push("Moneda: RON");
      lines.push(header);
      const after = balances(rows, 1200000);
      const pages = Math.ceil(rows.length / perPage);
      const cites = rows.map((t, index): Cite => {
        if (index > 0 && index % perPage === 0) {
          lines.push(`Pagina ${index / perPage} din ${pages}`);
          lines.page();
          lines.push(header);
        }
        const d = printDate(t.date, style.date);
        const a = `${t.direction === "debit" ? "-" : "+"}${printMoney(cents(t.amount), style)}`;
        const line = lines.push(`${d}\t${t.raw}\t${a}\t${printMoney(after[index], style)}`);
        return { lines: [line], d, a, c: null };
      });
      const total = printMoney(sumOfDebits(rows), style);
      const totalLine = lines.push(`Total debite\t${total}`);
      lines.push(`Pagina ${pages} din ${pages}`);
      return { lines, cites, total: { text: total, line: totalLine }, currency: "RON", columnWidth: 135 };
    },
  };
}

/** An English CSV of about fifty rows a parser reads: the size where mode "categorise" has real work to do. */
function csvEnMonth(): SyntheticStatement {
  return {
    id: "csv-en-month",
    description: "English CSV of about fifty rows (ISO dates, dot decimals, signed amounts, a currency column) that a parser reads, so mode \"categorise\" has a realistic list of merchants.",
    kind: "csv",
    parser: "ok",
    txns: ordinaryMonth(2027, 46, 2026, 9),
    build(rows) {
      const style: Style = { date: "iso", decimal: ".", thousands: "" };
      const lines = new Lines();
      lines.push("Date,Description,Amount,Currency");
      const cites = rows.map((t): Cite => {
        const d = printDate(t.date, style.date);
        const a = `${t.direction === "debit" ? "-" : "+"}${printMoney(cents(t.amount), style)}`;
        const line = lines.push(`${d},${t.raw},${a},${t.currency}`);
        return { lines: [line], d, a, c: t.currency };
      });
      return { lines, cites, total: null, currency: "RON" };
    },
  };
}

export const SYNTHETIC_STATEMENTS: SyntheticStatement[] = [
  csvEnIsoSigned(),
  csvEnDebitCredit(),
  csvRoMultiline(),
  csvRoForeign(),
  csvEnCurrencyInPreamble(),
  csvRoCommaDigitsBeforeAmount(),
  pdfEnTwoPages(),
  pdfRoTable(),
  pdfCardMultiline(),
  pdfRoNoYear(),
  pdfRoLargeMonth(),
  csvEnMonth(),
];

// ---------------------------------------------------------------------------------------------
// Output

export type GeneratedStatement = {
  id: string;
  kind: ImportSourceKind;
  /** The file's bytes. */
  bytes: Uint8Array;
  expected: Expected;
  answer: ReaderAnswer;
};

const expectedRow = (t: Txn): ExpectedRow => ({
  date: t.date,
  amount: Number(t.amount).toFixed(2),
  currency: t.currency,
  direction: t.direction,
  merchant: t.merchant,
  category: t.category,
  subtype: t.subtype,
});

/** What a perfect model answers in mode "read" for the statement: every field copied from what the renderer printed. */
function perfectAnswer(txns: readonly Txn[], built: Built): ReaderAnswer {
  const merchants = new Map<string, Txn>();
  for (const t of txns) if (!merchants.has(t.merchant)) merchants.set(t.merchant, t);
  return {
    r: txns.map((t, index) => ({
      l: built.cites[index].lines,
      d: built.cites[index].d,
      a: built.cites[index].a,
      c: built.cites[index].c,
      t: t.direction === "debit" ? "d" : "c",
      m: t.merchant,
    })),
    k: [...merchants.values()].map((t) => ({ m: t.merchant, c: t.category, s: t.subtype })),
    s: { c: built.currency, t: built.total?.text ?? null, l: built.total?.line ?? null },
  };
}

export function generateStatement(statement: SyntheticStatement): GeneratedStatement {
  const built = statement.build(statement.txns);
  let bytes: Uint8Array;
  if (statement.kind === "csv") {
    const eol = built.eol ?? "\n";
    bytes = new TextEncoder().encode(`${built.lines.all.join(eol)}${eol}`);
  } else {
    const pages = built.lines.pages.map((page): PdfLine[] => page.map((line) => (line.includes("\t") ? line.split("\t") : line)));
    bytes = buildTextPdf(pages, { columnWidth: built.columnWidth });
  }
  return {
    id: statement.id,
    kind: statement.kind,
    bytes,
    expected: {
      description: statement.description,
      currency: built.currency,
      parser: statement.parser,
      knownGap: statement.knownGap ?? null,
      rows: statement.txns.map(expectedRow),
    },
    answer: perfectAnswer(statement.txns, built),
  };
}

export function generateAll(): GeneratedStatement[] {
  return SYNTHETIC_STATEMENTS.map(generateStatement);
}
