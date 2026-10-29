/**
 * Masks account and card numbers in free text, so a statement's IBANs don't outlive the 24-hour
 * draft inside a saved description. It is also the helper to run before statement text leaves the
 * server for anywhere else.
 *
 * Two shapes are masked, each to "…" plus its last four characters:
 * - an IBAN-shaped token: two letters, two digits, then 11 to 30 letters or digits, written
 *   together or in groups of four with single spaces ("RO49 AAAA 1B31 0075 9384 0000"); the last
 *   group may be shorter, and must hold a digit so a following word isn't swallowed. No checksum
 *   or country length is checked, so invented values (RO00FAKE…) are masked too;
 * - a run of 12 or more digits, or card-style groups of four digits joined by spaces or hyphens.
 *
 * Ordinary text, amounts and dates aren't touched. The cost of the shape rules is that a word
 * written right after an IBAN may be masked with it when it holds a digit (or is part of the
 * number's last group).
 */
const IBAN = String.raw`[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]{4}){2,7}(?: ?(?=[A-Za-z0-9]{0,2}\d)[A-Za-z0-9]{1,3})?`;
const CARD_GROUPS = String.raw`\d{4}(?:[ -]\d{4}){2,4}`;
const DIGIT_RUN = String.raw`\d{12,}`;

const PATTERN = new RegExp(
  String.raw`(?<![A-Za-z0-9])(?:(${IBAN})|(${CARD_GROUPS}))(?![A-Za-z0-9])|(?<!\d)(${DIGIT_RUN})(?!\d)`,
  "g",
);

const MIN_IBAN_LENGTH = 15;

const alphanumerics = (token: string) => token.replace(/[^A-Za-z0-9]/g, "");

function mask(token: string): string {
  return `…${alphanumerics(token).slice(-4)}`;
}

/**
 * Masks an IBAN-shaped match. Trailing groups of letters only are handed back unmasked as long as
 * 15 characters remain: they are far more likely to be the next word ("… 0000 rent") than the
 * end of the number, whose last group holds a digit.
 */
function maskIban(match: string): string {
  const groups = match.split(" ");
  const tail: string[] = [];
  while (
    groups.length > 1 &&
    !/\d/.test(groups[groups.length - 1]) &&
    alphanumerics(groups.slice(0, -1).join("")).length >= MIN_IBAN_LENGTH
  ) {
    tail.unshift(groups.pop()!);
  }
  const kept = groups.join(" ");
  if (alphanumerics(kept).length < MIN_IBAN_LENGTH) return match;
  return [mask(kept), ...tail].join(" ");
}

export function maskAccountNumbers(text: string): string {
  return text.replace(PATTERN, (match, iban?: string) => (iban ? maskIban(match) : mask(match)));
}
