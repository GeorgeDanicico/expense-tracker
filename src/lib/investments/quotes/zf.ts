import { isValidDate } from "@/lib/calendar";
import { isInvestmentCurrency } from "@/lib/investments/types";
import type { Quote } from "@/lib/investments/quotes/types";

/** The funds read from zf.ro, each with its page. Every other instrument goes to Yahoo. */
export const ZF_FUND_PAGES: Readonly<Record<string, string>> = {
  BTEUROCLASIC: "https://www.zf.ro/fonduri-mutuale/fonduri-diversificate/bt-euro-clasic-14501383-fond",
};

// The fund box is `<div class="… fond-mutual …">`; its first `<p><strong>` holds the unit value
// (`13,5200  eur`) and a later `<p style="font-size:…">` the date it's from (`… din data de 2026-09-09`).
const PRICE_ELEMENT = /<div\b[^>]*\bclass\s*=\s*(['"])[^'"]*\bfond-mutual\b[^'"]*\1[^>]*>.*?<p\b[^>]*>\s*<strong\b[^>]*>(?<value>.*?)<\/strong\s*>/is;
const DATE_ELEMENT = /<div\b[^>]*\bclass\s*=\s*(['"])[^'"]*\bfond-mutual\b[^'"]*\1[^>]*>.*?<p\b[^>]*\bstyle\s*=\s*(['"])[^'"]*font-size[^'"]*\2[^>]*>.*?(?<date>\d{4}-\d{2}-\d{2})/is;
const PRICE = /(?<price>\d+(?:[.,]\d+)?)\s*(?<currency>[A-Za-z]{3})?/;
const MARKUP = /<[^>]*>/gs;

/**
 * The fund's unit value on a zf.ro fund page, or `null` when the page has no price, currency and
 * date the app can use. The price keeps the page's digits, with `,` read as the decimal point.
 */
export function parseZfPage(instrument: string, html: string): Quote | null {
  const value = PRICE_ELEMENT.exec(html)?.groups?.value;
  if (value === undefined) return null;

  const match = PRICE.exec(value.replaceAll("&nbsp;", " ").replace(MARKUP, " ").trim());
  const price = match?.groups?.price?.replace(",", ".");
  const currency = match?.groups?.currency?.toUpperCase();
  const asOf = DATE_ELEMENT.exec(html)?.groups?.date;
  if (!price || !currency || !isInvestmentCurrency(currency) || !asOf || !isValidDate(asOf)) return null;

  return { instrument, price, currency, asOf, source: "ZF" };
}
