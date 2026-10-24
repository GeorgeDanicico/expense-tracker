import { describe, expect, it } from "vitest";

import { positionBetween } from "@/lib/todos/position";

/** Byte-order comparison, as Postgres sorts a `collate "C"` column. */
const isSorted = (keys: string[]) => keys.every((key, index) => index === 0 || keys[index - 1] < key);

describe("positionBetween", () => {
  it("gives an empty column its first key", () => {
    expect(positionBetween(null, null)).toBe("a0");
  });

  it("puts a card above the top card", () => {
    const key = positionBetween(null, "a0");
    expect(key < "a0").toBe(true);
  });

  it("puts a card below the bottom card", () => {
    const key = positionBetween("a0", null);
    expect(key > "a0").toBe(true);
  });

  it("puts a card between two cards", () => {
    const key = positionBetween("a0", "a2");
    expect("a0" < key && key < "a2").toBe(true);
  });

  it("puts a card between two adjacent keys", () => {
    const key = positionBetween("a0", "a1");
    expect("a0" < key && key < "a1").toBe(true);
  });

  it("keeps 1,000 inserts at the same spot sorted and distinct", () => {
    const top = "a0";
    let bottom = "a1";
    const keys = [top, bottom];
    for (let index = 0; index < 1000; index += 1) {
      bottom = positionBetween(top, bottom);
      keys.push(bottom);
    }
    const sorted = [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(new Set(keys).size).toBe(keys.length);
    expect(isSorted(sorted)).toBe(true);
    expect(sorted[0]).toBe(top);
    expect(sorted.at(-1)).toBe("a1");
    // Each new key sits just below the previous one, directly under the top card.
    expect(sorted.slice(1, -1)).toEqual(keys.slice(2).reverse());
  });

  it("keeps 1,000 inserts at the top of a column sorted", () => {
    let top: string | null = null;
    const keys: string[] = [];
    for (let index = 0; index < 1000; index += 1) {
      top = positionBetween(null, top);
      keys.unshift(top);
    }
    expect(isSorted(keys)).toBe(true);
  });

  it("rejects neighbours out of order and malformed keys", () => {
    expect(() => positionBetween("a1", "a0")).toThrow();
    expect(() => positionBetween("a0", "a0")).toThrow();
    expect(() => positionBetween("!", null)).toThrow();
  });
});
