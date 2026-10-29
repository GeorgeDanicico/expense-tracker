import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  flagDuplicates,
  normaliseMerchant,
  notesSource,
  similarMerchants,
  type ExistingExpense,
} from "@/lib/imports/duplicates";

let nextId = 1;
const existing = (overrides: Partial<ExistingExpense> = {}): ExistingExpense => ({
  id: `expense-${nextId++}`,
  description: "Lidl",
  expenseDate: "2026-10-12",
  amount: 45.2,
  notes: null,
  ...overrides,
});

const row = (overrides: Partial<{ expenseDate: string; description: string; amount: number }> = {}) => ({
  expenseDate: "2026-10-12",
  description: "Lidl",
  amount: 45.2,
  ...overrides,
});

describe("normaliseMerchant", () => {
  it.each([
    ["LIDL", "lidl"],
    ["Cărturești Verona", "carturesti verona"],
    ["Lidl Nr. 1234, Cluj", "lidl nr cluj"],
    ["  Mega   Image\t", "mega image"],
    ["POS 12345 *OMV-1642", "pos omv"],
    ["1234", ""],
  ])("turns %j into %j", (text, normalised) => {
    expect(normaliseMerchant(text)).toBe(normalised);
  });
});

describe("similarMerchants", () => {
  it.each([
    ["Lidl", "LIDL", "case"],
    ["Cărturești", "CARTURESTI", "accents"],
    ["Lidl", "Lidl 1234 Satu Mare", "one contains the other"],
    ["OMV 1642 Satu Mare", "OMV", "the other way round"],
    ["Pizza Roma", "Roma Pizza Bucuresti", "words overlap by half or more"],
    ["Mega Image 12", "Mega Image 345", "digits are dropped"],
  ])("%j and %j are similar (%s)", (a, b) => {
    expect(similarMerchants(a, b)).toBe(true);
  });

  it.each([
    ["Lidl", "Kaufland", "different merchants"],
    ["Kaufland Satu Mare", "Kaufland Cluj Napoca", "a shared word is under half of all the words"],
    ["AB", "ABC Market", "a one- or two-letter name isn't \"contained\" in another"],
    ["1234", "5678", "nothing is left after normalising"],
    ["", "Lidl", "an empty description"],
  ])("%j and %j are not similar (%s)", (a, b) => {
    expect(similarMerchants(a, b)).toBe(false);
  });
});

describe("notesSource", () => {
  it("reads the merchant of the statement envelope's source", () => {
    expect(notesSource("BT Star Forte statement 2026-08; processed: 2026-08-05; transaction: 2026-08-03 22:41; source: OMV 1642 Satu Mare"))
      .toBe("OMV 1642 Satu Mare");
  });

  it.each([null, "", "Paid in cash", "resource: none"])("finds none in %j", (notes) => {
    expect(notesSource(notes)).toBeNull();
  });
});

describe("flagDuplicates", () => {
  it("flags a row with the same date and amount and a similar merchant, quoting the expense", () => {
    const lidl = existing({ id: "lidl", description: "LIDL Satu Mare", notes: "weekly shop" });

    const [flag] = flagDuplicates([row()], [lidl]);

    expect(flag).toEqual({ id: "lidl", description: "LIDL Satu Mare", expenseDate: "2026-10-12", amount: 45.2 });
  });

  it("returns one entry per row, in order", () => {
    const flags = flagDuplicates(
      [row({ description: "Kaufland", amount: 7 }), row(), row({ expenseDate: "2026-10-13" })],
      [existing({ id: "lidl" })],
    );

    expect(flags.map((flag) => flag?.id ?? null)).toEqual([null, "lidl", null]);
  });

  it("ignores accents and case", () => {
    const [flag] = flagDuplicates([row({ description: "CARTURESTI VERONA" })], [existing({ id: "books", description: "Cărturești" })]);

    expect(flag?.id).toBe("books");
  });

  it("does not flag a different amount, even by one cent", () => {
    expect(flagDuplicates([row({ amount: 45.21 })], [existing()])).toEqual([null]);
    expect(flagDuplicates([row({ amount: 45.19 })], [existing()])).toEqual([null]);
  });

  it("does not flag a different day", () => {
    expect(flagDuplicates([row({ expenseDate: "2026-10-11" })], [existing()])).toEqual([null]);
    expect(flagDuplicates([row({ expenseDate: "2026-10-13" })], [existing()])).toEqual([null]);
  });

  it("does not flag a different merchant with the same date and amount", () => {
    expect(flagDuplicates([row({ description: "Kaufland" })], [existing()])).toEqual([null]);
  });

  it("compares amounts to the cent without floating-point drift", () => {
    const [flag] = flagDuplicates([row({ amount: 0.1 + 0.2 })], [existing({ id: "tiny", amount: 0.3 })]);

    expect(flag?.id).toBe("tiny");
  });

  describe("one-to-one", () => {
    it("flags one of two identical coffees against one saved expense: the first", () => {
      const coffee = { description: "Starbucks", amount: 4.5 };

      const flags = flagDuplicates([row(coffee), row(coffee)], [existing({ id: "saved", ...coffee })]);

      expect(flags.map((flag) => flag?.id ?? null)).toEqual(["saved", null]);
    });

    it("flags both when both are saved", () => {
      const coffee = { description: "Starbucks", amount: 4.5 };

      const flags = flagDuplicates(
        [row(coffee), row(coffee)],
        [existing({ id: "first", ...coffee }), existing({ id: "second", ...coffee })],
      );

      expect(flags.map((flag) => flag?.id)).toEqual(["first", "second"]);
    });

    it("gives a row the next matching expense when an earlier row took the first", () => {
      const flags = flagDuplicates(
        [row({ description: "Lidl" }), row({ description: "Lidl Satu Mare" })],
        [existing({ id: "a", description: "Lidl" }), existing({ id: "b", description: "Lidl 12" })],
      );

      expect(flags.map((flag) => flag?.id)).toEqual(["a", "b"]);
    });

    it("lets a row pass over an expense that an earlier row already took", () => {
      const flags = flagDuplicates([row(), row()], [existing({ id: "only" })]);

      expect(flags.filter((flag) => flag !== null)).toHaveLength(1);
    });
  });

  describe("the notes envelope", () => {
    const envelope = (source: string) =>
      `BT Star Forte statement 2026-10; processed: 2026-10-14; transaction: 2026-10-12 18:02; source: ${source}`;

    it("compares the source when the description is neutral", () => {
      const saved = existing({ id: "fuel", description: "Card payment", amount: 300, notes: envelope("OMV 1642 Satu Mare") });

      const [flag] = flagDuplicates([row({ description: "OMV 1642 Satu Mare", amount: 300 })], [saved]);

      expect(flag).toEqual({ id: "fuel", description: "Card payment", expenseDate: "2026-10-12", amount: 300 });
    });

    it("does not flag when neither the description nor the source is similar", () => {
      const saved = existing({ description: "Card payment", amount: 300, notes: envelope("Autonet Satu Mare") });

      expect(flagDuplicates([row({ description: "OMV", amount: 300 })], [saved])).toEqual([null]);
    });

    it("ignores ordinary notes", () => {
      const saved = existing({ description: "Card payment", amount: 300, notes: "OMV" });

      expect(flagDuplicates([row({ description: "OMV", amount: 300 })], [saved])).toEqual([null]);
    });
  });

  it("flags nothing against no expenses, and nothing for no rows", () => {
    expect(flagDuplicates([row()], [])).toEqual([null]);
    expect(flagDuplicates([], [existing()])).toEqual([]);
  });
});

describe("flagDuplicates on the fixtures", () => {
  const fixture = (name: string) =>
    (JSON.parse(readFileSync(fileURLToPath(new URL(`./__fixtures__/generic-csv/${name}.expected.json`, import.meta.url)), "utf8")) as {
      rows: { expenseDate: string; description: string; amount: number; direction: string }[];
    }).rows.filter((fixtureRow) => fixtureRow.direction === "debit");

  it("flags every row of a statement already saved by hand with other spellings of the merchants", () => {
    // The same three purchases as the windows-1250 fixture, typed with comma-below letters, capitals and no accents.
    const saved = [
      existing({ id: "piata", description: "Piața Verde", expenseDate: "2026-09-14", amount: 25 }),
      existing({ id: "bacania", description: "BACANIA TARII", expenseDate: "2026-09-15", amount: 9.75 }),
      existing({ id: "cafe", description: "cafeneaua ingerilor", expenseDate: "2026-09-16", amount: 18.5 }),
    ];

    const flags = flagDuplicates(fixture("windows-1250"), saved);

    expect(flags.map((flag) => flag?.id)).toEqual(["piata", "bacania", "cafe"]);
  });

  it("flags nothing against expenses of the same days and amounts at other merchants", () => {
    const saved = fixture("windows-1250").map((fixtureRow) => existing({ ...fixtureRow, description: "Kaufland" }));

    expect(flagDuplicates(fixture("windows-1250"), saved)).toEqual([null, null, null]);
  });
});
