import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aKid, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET } from "@/app/api/insights/route";

const get = (query = "") => callRoute(GET, { url: `/api/insights${query}` });

describe("GET /api/insights", () => {
  let user: ReturnType<typeof signedInAs>;
  let repositories: FakeRepositories;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
    user = signedInAs();
    repositories = resetFakeRepositories();
    const monthly = (month: string, groceries: number) => [
      anExpense({ id: `${month}-rent`, description: "Rent", category: "housing", amount: 1000, expenseDate: `${month}-01` }),
      anExpense({ id: `${month}-kaufland`, description: "Kaufland Satu Mare", category: "groceries", amount: groceries, expenseDate: `${month}-05` }),
      anExpense({ id: `${month}-spotify`, description: "Spotify", category: "entertainment", amount: 25, expenseDate: `${month}-12` }),
    ];
    repositories.expenses.expenses.set(user.id, [...monthly("2026-08", 300), ...monthly("2026-09", 300), ...monthly("2026-10", 600)]);
    repositories.expenses.expenses.set("someone-else", [anExpense({ description: "Kaufland", amount: 9999, expenseDate: "2026-10-05" })]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("answers a finished month's changes and recurring payments from the caller's own expenses", async () => {
    const response = await get("?month=2026-10");

    expect(response.status).toBe(200);
    expect(response.body.month).toBe("2026-10");
    expect(response.body.changes).toEqual(expect.objectContaining({ month: "2026-10", previousMonth: "2026-09", throughDay: null }));
    expect(response.body.changes.changes).toEqual([
      expect.objectContaining({ kind: "category", key: "groceries", current: 600, previous: 300, average: 300 }),
    ]);
    expect(response.body.recurring).toEqual(expect.objectContaining({ monthlyTotal: 1025 }));
    expect(response.body.recurring.payments).toEqual([
      expect.objectContaining({ label: "Rent", months: 3, charged: true }),
      expect.objectContaining({ label: "Spotify", months: 3, charged: true }),
    ]);
    expect(response.body.viewing).toEqual(expect.objectContaining({ readOnly: false }));
  });

  it("reads the months the recurring payments look back over, through the end of the month", async () => {
    const listRange = vi.spyOn(repositories.expenses, "listRange");

    await get("?month=2026-10");

    expect(listRange).toHaveBeenCalledWith(user.id, { start: "2026-04-01", endExclusive: "2026-11-01" });
  });

  it("compares the current month up to today when no month is given", async () => {
    const response = await get();

    expect(response.body.month).toBe("2026-11");
    expect(response.body.changes.throughDay).toBe(20);
    expect(response.body.recurring.payments).toContainEqual(expect.objectContaining({ label: "Spotify", charged: false, lastMonth: "2026-10" }));
  });

  it("refuses the whole family, whose currencies may differ", async () => {
    expect(await get("?member=all")).toMatchObject({ status: 400, body: { error: "Choose one family member to see their spending insights." } });
  });

  it("refuses a kid with expenses off, before reading anything", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");
    repositories.family.membership = aKid({ permissions: { expenses: "off", investments: "edit", net_worth: "edit", family_finance: "view", mcp: "off", ai: "off" } });
    const listRange = vi.spyOn(repositories.expenses, "listRange");

    expect(await get()).toMatchObject({ status: 403 });
    expect(listRange).not.toHaveBeenCalled();
  });

  it("reports a storage failure with its own message", async () => {
    vi.spyOn(repositories.expenses, "listRange").mockRejectedValue(new Error("private failure"));

    expect(await get()).toMatchObject({ status: 500, body: { error: "Unable to load spending insights." } });
  });
});
