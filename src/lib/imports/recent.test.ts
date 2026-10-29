import { describe, expect, it } from "vitest";

import {
  discardDescription,
  expiresIn,
  formatInstantDay,
  importMeta,
  importTitle,
  isExpired,
  undoAdvice,
  undoneMessage,
  undoSummary,
  visibleImports,
} from "@/lib/imports/recent";
import type { RecentImport } from "@/lib/imports/repository";
import type { ImportBatch } from "@/lib/imports/types";

const now = new Date("2026-10-29T12:00:00Z");

function aBatch(overrides: Partial<ImportBatch> = {}): ImportBatch {
  return {
    id: "b1",
    status: "draft",
    sourceKind: "csv",
    parserId: "generic-csv",
    currency: "EUR",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-28",
    rowCount: 37,
    skippedCredits: 0,
    createdAt: "2026-10-28T17:00:00Z",
    expiresAt: "2026-10-29T17:00:00Z",
    confirmedAt: null,
    confirmedCount: null,
    undoneAt: null,
    ...overrides,
  };
}

function anImport(overrides: Partial<ImportBatch> = {}, counts: Partial<RecentImport> = {}): RecentImport {
  return { batch: aBatch(overrides), expenseCount: 0, changedCount: 0, ...counts };
}

const confirmed = (counts: Partial<RecentImport> = {}) => anImport({
  status: "confirmed",
  expiresAt: null,
  confirmedAt: "2026-10-03T09:00:00Z",
  confirmedCount: 37,
}, { expenseCount: 37, ...counts });

describe("formatInstantDay", () => {
  it("names the day in the app's time zone, short or long", () => {
    // 22:30 UTC is already the next day in Bucharest.
    expect(formatInstantDay("2026-10-02T22:30:00Z", { now })).toBe("3 Oct");
    expect(formatInstantDay("2026-10-03T09:00:00Z", { now, long: true })).toBe("3 October");
  });

  it("adds the year when it isn't this year's", () => {
    expect(formatInstantDay("2025-12-30T09:00:00Z", { now })).toBe("30 Dec 2025");
    expect(formatInstantDay("2025-12-30T09:00:00Z", { now, long: true })).toBe("30 December 2025");
  });
});

describe("expiresIn", () => {
  const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const minutes = (count: number) => count * 60_000;

  it("counts hours, rounded up so it never promises more time than there is", () => {
    expect(expiresIn(at(19 * 60 * minutes(1)), now)).toBe("expires in 19 h");
    expect(expiresIn(at(18 * 60 * minutes(1) + minutes(20)), now)).toBe("expires in 19 h");
    expect(expiresIn(at(60 * minutes(1)), now)).toBe("expires in 1 h");
  });

  it("counts minutes in the last hour and says so under a minute", () => {
    expect(expiresIn(at(minutes(35) + 5_000), now)).toBe("expires in 35 min");
    expect(expiresIn(at(30_000), now)).toBe("expires in under a minute");
  });

  it("says expired once the time is up", () => {
    expect(expiresIn(at(0), now)).toBe("expired");
    expect(expiresIn(at(-minutes(5)), now)).toBe("expired");
  });
});

describe("isExpired and visibleImports", () => {
  it("treats only a draft past its expiry as expired", () => {
    expect(isExpired(aBatch({ expiresAt: "2026-10-29T11:59:00Z" }), now)).toBe(true);
    expect(isExpired(aBatch({ expiresAt: "2026-10-29T12:01:00Z" }), now)).toBe(false);
    expect(isExpired(aBatch({ status: "confirmed", expiresAt: null }), now)).toBe(false);
  });

  it("hides expired drafts and keeps everything else in order", () => {
    const list = [
      anImport({ id: "old", expiresAt: "2026-10-29T11:00:00Z" }),
      anImport({ id: "live" }),
      confirmed(),
    ];
    expect(visibleImports(list, now).map((item) => item.batch.id)).toEqual(["live", "b1"]);
  });
});

describe("importTitle", () => {
  it("names the statement by its period", () => {
    expect(importTitle(aBatch(), now)).toBe("Statement of 1 Oct to 28 Oct 2026");
    expect(importTitle(aBatch({ periodStart: "2026-10-12", periodEnd: "2026-10-12" }), now)).toBe("Statement of 12 Oct 2026");
  });

  it("falls back to the upload day for a statement with no period", () => {
    expect(importTitle(aBatch({ periodStart: null, periodEnd: null }), now)).toBe("Statement uploaded 28 Oct");
  });
});

describe("importMeta", () => {
  it("gives a draft its rows, upload day and time left", () => {
    expect(importMeta(anImport(), now)).toEqual(["37 rows", "uploaded 28 Oct", "expires in 5 h"]);
    expect(importMeta(anImport({ rowCount: 1 }), now)[0]).toBe("1 row");
  });

  it("gives a confirmed import its expenses and the day it was imported", () => {
    expect(importMeta(confirmed(), now)).toEqual(["37 expenses", "imported 3 Oct"]);
  });

  it("gives an undone import the day it was undone", () => {
    const undone = anImport({
      status: "undone",
      expiresAt: null,
      confirmedAt: "2026-10-03T09:00:00Z",
      confirmedCount: 1,
      undoneAt: "2026-10-05T09:00:00Z",
    });
    expect(importMeta(undone, now)).toEqual(["1 expense", "undone 5 Oct"]);
  });
});

describe("undoSummary", () => {
  it("says how many expenses go and when they were imported", () => {
    expect(undoSummary({ expenseCount: 37, changedCount: 0 }, "3 October"))
      .toBe("This removes 37 expenses you imported on 3 October.");
  });

  it("says how many of them were changed since", () => {
    expect(undoSummary({ expenseCount: 37, changedCount: 2 }, "3 October"))
      .toBe("This removes 37 expenses you imported on 3 October, 2 of them changed since.");
    expect(undoSummary({ expenseCount: 2, changedCount: 2 }, "3 October"))
      .toBe("This removes 2 expenses you imported on 3 October, all of them changed since.");
    expect(undoSummary({ expenseCount: 1, changedCount: 1 }, "3 October"))
      .toBe("This removes 1 expense you imported on 3 October, and it has changed since.");
  });

  it("says so when none of the expenses are left", () => {
    expect(undoSummary({ expenseCount: 0, changedCount: 0 }, "3 October"))
      .toBe("None of the expenses this import added are left, so nothing is removed.");
  });
});

describe("undoAdvice", () => {
  it("says that your own expenses stay and that the statement can come back", () => {
    expect(undoAdvice({ expenseCount: 37, changedCount: 2 }))
      .toBe("Expenses you added yourself stay. The statement can be imported again afterwards.");
    expect(undoAdvice({ expenseCount: 0, changedCount: 0 })).toBe("The statement can be imported again afterwards.");
  });
});

describe("messages", () => {
  it("words the outcome of an undo and the discard question", () => {
    expect(undoneMessage(37)).toBe("Import undone. 37 expenses removed.");
    expect(undoneMessage(1)).toBe("Import undone. 1 expense removed.");
    expect(discardDescription(8)).toBe("The 8 rows read from the statement are deleted. Nothing is added to your expenses.");
  });
});
