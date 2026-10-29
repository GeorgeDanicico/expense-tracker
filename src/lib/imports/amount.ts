/**
 * Reads money from statement text into integer cents, so nothing is a float until the end.
 *
 * The decimal mark is a property of a whole column, not of one cell: "1.234" is 1,234 in one
 * export and 1.234 in another. `detectDecimalMark` decides it once from all the cells and refuses
 * when nothing settles it; `parseAmount` then reads each cell with that mark.
 */

export type DecimalMark = "." | ",";

/** The largest value `parseAmount` returns, in cents (the 12-digit `numeric(12, 2)` limit). */
const MAX_CENTS = 999_999_999_999;

/** Currency symbols, and three-letter codes or words (RON, EUR, lei) at either end of the text. */
const CURRENCY_TOKENS = /\p{Sc}|(?<![\p{L}])\p{L}{3}(?![\p{L}])/gu;
/** Non-breaking, narrow and thin spaces and the like, which exports use as thousands separators. */
const SPACES = /[\s    ]+/gu;

type Cleaned = { negative: boolean; core: string };

/**
 * Strips currency symbols and codes, spaces and the sign (a leading or trailing minus or plus, or
 * parentheses) and returns what is left: digits, separators and thousands spaces. Null when the
 * text holds anything else, or two signs.
 */
function clean(text: string): Cleaned | null {
  let rest = text.replace(CURRENCY_TOKENS, " ").replace(/−/g, "-").replace(SPACES, " ").trim();
  let negative = false;
  let signs = 0;

  const parenthesised = /^\((.*)\)$/.exec(rest);
  if (parenthesised) {
    negative = true;
    signs += 1;
    rest = parenthesised[1].trim();
  }

  const leading = /^([-+])\s*/.exec(rest);
  if (leading) {
    negative = leading[1] === "-";
    signs += 1;
    rest = rest.slice(leading[0].length);
  } else {
    const trailing = /\s*([-+])$/.exec(rest);
    if (trailing) {
      negative = trailing[1] === "-";
      signs += 1;
      rest = rest.slice(0, rest.length - trailing[0].length);
    }
  }

  if (signs > 1 || !/^[\d .,'’]+$/.test(rest) || !/\d/.test(rest)) return null;
  return { negative, core: rest };
}

function countOf(text: string, mark: string): number {
  return text.split(mark).length - 1;
}

/** `.` or `,` when the cell settles the decimal mark, `"ambiguous"` when it can't say, null when it isn't a number. */
function markOf(core: string): DecimalMark | "ambiguous" | "none" | null {
  const dots = countOf(core, ".");
  const commas = countOf(core, ",");
  if (dots === 0 && commas === 0) return "none";

  if (dots > 0 && commas > 0) {
    // Both appear: the last one is the decimal mark and the other groups thousands.
    const decimal: DecimalMark = core.lastIndexOf(".") > core.lastIndexOf(",") ? "." : ",";
    return countOf(core, decimal) === 1 ? decimal : null;
  }

  const mark: DecimalMark = dots > 0 ? "." : ",";
  // The same mark twice or more can only be thousands (1.234.567), so the decimal mark is the other.
  if (countOf(core, mark) > 1) return mark === "." ? "," : ".";
  const after = core.length - core.lastIndexOf(mark) - 1;
  if (after === 1 || after === 2) return mark;
  // One mark followed by three digits is "1.234": thousands or decimals, nothing says which.
  return after === 3 ? "ambiguous" : null;
}

/**
 * The decimal mark of a column of amounts, decided once for all of it. A cell with exactly one or
 * two digits after its last separator settles it ("45,20"), as does one with both marks
 * ("1.234,56") or one mark repeated ("1.234.567"). Returns null, to be refused and never guessed,
 * when the cells disagree or when the only evidence is ambiguous (a column holding just "1.234").
 * A column with no separator at all needs no mark and gets ".". Cells that aren't numbers are
 * ignored here and fail in `parseAmount`.
 */
export function detectDecimalMark(cells: readonly string[]): DecimalMark | null {
  let settled: DecimalMark | null = null;
  let ambiguous = false;

  for (const cell of cells) {
    const cleaned = clean(cell);
    if (!cleaned) continue;
    const mark = markOf(cleaned.core);
    if (mark === "ambiguous") ambiguous = true;
    else if (mark === "." || mark === ",") {
      if (settled && settled !== mark) return null;
      settled = mark;
    }
  }

  if (settled) return settled;
  return ambiguous ? null : ".";
}

/**
 * Reads an amount as integer cents, negative for a minus sign (leading or trailing) or
 * parentheses. Handles "1.234,56", "1,234.56", "45,20", "-45.20", "45.20-", "(45.20)", currency
 * symbols and codes ("€ 45.20", "45,20 RON") and non-breaking spaces. Thousands groups must be
 * three digits; at most two decimals (more only when they are zeros). Returns null for anything
 * else, and for a value above 9999999999.99.
 */
export function parseAmount(text: string, options: { decimal: DecimalMark }): number | null {
  const cleaned = clean(text);
  if (!cleaned) return null;
  const { decimal } = options;
  const thousands = decimal === "." ? "," : ".";

  const parts = cleaned.core.split(decimal);
  if (parts.length > 2) return null;
  const [integerText, fractionText = ""] = parts;

  const grouping = new RegExp(`^\\d{1,3}(?:[ ${thousands === "." ? "\\." : ","}'’]\\d{3})+$`);
  if (!/^\d*$/.test(integerText) && !grouping.test(integerText)) return null;
  if (integerText === "" && fractionText === "") return null;
  if (!/^\d*$/.test(fractionText)) return null;
  // Extra decimals are fine only when they are zeros (12.500).
  if (fractionText.length > 2 && !/^\d{2}0*$/.test(fractionText)) return null;

  const digits = integerText.replace(/\D/g, "");
  if (digits.length > 13) return null;
  const cents = Number(digits || "0") * 100 + Number(fractionText.slice(0, 2).padEnd(2, "0"));
  if (cents > MAX_CENTS) return null;
  return cleaned.negative && cents !== 0 ? -cents : cents;
}

/** Whole cents as an amount in major units (4520 becomes 45.2), for the stored shapes. */
export function centsToAmount(cents: number): number {
  return cents / 100;
}

/** An amount in major units as whole cents: the inverse of `centsToAmount` for two-decimal values. */
export function amountToCents(amount: number): number {
  return Math.round(amount * 100);
}
