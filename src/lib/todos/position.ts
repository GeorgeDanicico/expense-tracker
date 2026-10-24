import { generateKeyBetween } from "fractional-indexing";

/**
 * A fractional-index key that sorts strictly between `before` (the card above) and `after`
 * (the card below). `null` means no neighbour on that side, so `positionBetween(null, null)`
 * is the first key of an empty column. Keys compare byte by byte (JS `<`, Postgres collate "C").
 *
 * Throws if `before` is not strictly less than `after`, or if a key is malformed. The library
 * would quietly swap neighbours given in the wrong order; here that means stale data, so it fails.
 */
export function positionBetween(before: string | null, after: string | null): string {
  if (before !== null && after !== null && !(before < after)) {
    throw new Error(`Position ${before} must sort before ${after}.`);
  }
  return generateKeyBetween(before, after);
}
