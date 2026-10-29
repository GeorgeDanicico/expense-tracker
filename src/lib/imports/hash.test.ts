import { describe, expect, it } from "vitest";

import { statementHash, type HashableRow } from "@/lib/imports/hash";

const ROWS: HashableRow[] = [
  { expenseDate: "2026-10-01", description: "LIDL BUCURESTI", amount: 45.2, currency: "RON" },
  { expenseDate: "2026-10-02", description: "OMV Petrom", amount: 310, currency: "RON" },
  { expenseDate: "2026-10-03", description: "Coffee", amount: 12.5, currency: "RON" },
];

describe("statementHash", () => {
  it("is 64 lowercase hex characters, as the database checks", () => {
    expect(statementHash(ROWS)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is SHA-256 of the sorted lines: date, cents, currency and description, tab separated", () => {
    expect(statementHash(ROWS)).toBe(statementHash(ROWS.map((row) => ({ ...row }))));
    expect(statementHash(ROWS)).toBe("dbc45ba2240053d79871fee4fee84148e5d879c44b5042fc456edad29dadedc4");
  });

  it("ignores the order of the rows", () => {
    expect(statementHash([...ROWS].reverse())).toBe(statementHash(ROWS));
    expect(statementHash([ROWS[1], ROWS[2], ROWS[0]])).toBe(statementHash(ROWS));
  });

  it("changes with one cent", () => {
    const changed = ROWS.map((row, index) => (index === 1 ? { ...row, amount: 310.01 } : row));
    expect(statementHash(changed)).not.toBe(statementHash(ROWS));
  });

  it("changes with a day, a currency or a merchant", () => {
    const first = ROWS[0];
    expect(statementHash([{ ...first, expenseDate: "2026-10-02" }, ...ROWS.slice(1)])).not.toBe(statementHash(ROWS));
    expect(statementHash([{ ...first, currency: "EUR" }, ...ROWS.slice(1)])).not.toBe(statementHash(ROWS));
    expect(statementHash([{ ...first, description: "KAUFLAND" }, ...ROWS.slice(1)])).not.toBe(statementHash(ROWS));
  });

  it("changes when a row is added, removed or repeated", () => {
    expect(statementHash(ROWS.slice(0, 2))).not.toBe(statementHash(ROWS));
    expect(statementHash([...ROWS, ROWS[2]])).not.toBe(statementHash(ROWS));
  });

  it("matches a re-download that differs in case, accents, spacing and currency case", () => {
    const redownload: HashableRow[] = [
      { expenseDate: "2026-10-01", description: "  lidl   bucurești ", amount: 45.2, currency: "ron" },
      { expenseDate: "2026-10-02", description: "OMV PETROM", amount: 310, currency: "RON" },
      { expenseDate: "2026-10-03", description: "Café", amount: 12.5, currency: "RON" },
    ];
    const original: HashableRow[] = [
      { ...ROWS[0], description: "LIDL BUCURESTI" },
      ROWS[1],
      { ...ROWS[2], description: "Cafe" },
    ];
    expect(statementHash(redownload)).toBe(statementHash(original));
  });

  it("does not let a tab or newline in a description blur the rows", () => {
    const one = statementHash([{ expenseDate: "2026-10-01", description: "A\t100\tRON\nB", amount: 1, currency: "RON" }]);
    const two = statementHash([
      { expenseDate: "2026-10-01", description: "A", amount: 1, currency: "RON" },
      { expenseDate: "2026-10-01", description: "B", amount: 1, currency: "RON" },
    ]);
    expect(one).not.toBe(two);
  });

  it("hashes an empty statement", () => {
    expect(statementHash([])).toMatch(/^[0-9a-f]{64}$/);
  });
});
