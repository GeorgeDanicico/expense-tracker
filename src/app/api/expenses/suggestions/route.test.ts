import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { aKid, aParent, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { callRoute, signedInAs } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { GET } from "@/app/api/expenses/suggestions/route";
import { SUGGESTION_SCAN_ROWS } from "@/lib/expenses/suggestions";

const get = (query: string) => callRoute(GET, { url: `/api/expenses/suggestions?q=${encodeURIComponent(query)}` });

describe("GET /api/expenses/suggestions", () => {
  let user: ReturnType<typeof signedInAs>;
  let repositories: FakeRepositories;

  beforeEach(() => {
    vi.clearAllMocks();
    user = signedInAs();
    repositories = resetFakeRepositories();
    // In creation order: the last is the newest.
    repositories.expenses.expenses.set(user.id, [
      anExpense({ id: "a", description: "Fuel", category: "transport", expenseDate: "2026-09-01" }),
      anExpense({ id: "b", description: "Fuel", category: "car", subtype: "car_fuel", expenseDate: "2026-10-01" }),
      anExpense({ id: "c", description: "Fuel", category: "car", subtype: "car_fuel", expenseDate: "2026-10-02" }),
      anExpense({ id: "d", description: "Farmers market", category: "groceries", expenseDate: "2026-10-03" }),
    ]);
    repositories.expenses.expenses.set("someone-else", [anExpense({ id: "x", description: "Furniture", category: "housing" })]);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("answers the caller's own matching descriptions, ranked, with the guess", async () => {
    const response = await get("f");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      suggestions: [
        { description: "Fuel", uses: 3, category: "car", subtype: "car_fuel" },
        { description: "Farmers market", uses: 1, category: "groceries", subtype: null },
      ],
      guess: { category: "car", subtype: "car_fuel" },
    });
  });

  it("guesses nothing for an unknown description", async () => {
    expect((await get("Dentist")).body).toEqual({ suggestions: [], guess: null });
  });

  it("reads only the caller's newest expenses, never a member's", async () => {
    const recent = vi.spyOn(repositories.expenses, "recentDescriptions");

    await callRoute(GET, { url: "/api/expenses/suggestions?q=fu&member=someone-else" });

    expect(recent).toHaveBeenCalledWith(user.id, SUGGESTION_SCAN_ROWS);
  });

  it("refuses a kid with expenses off, before reading anything", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");
    repositories.family.membership = aKid({ permissions: { expenses: "off", investments: "edit", net_worth: "edit", family_finance: "view", mcp: "off", ai: "off" } });
    const recent = vi.spyOn(repositories.expenses, "recentDescriptions");

    expect(await get("fu")).toMatchObject({ status: 403, body: { error: "You don't have access to this." } });
    expect(recent).not.toHaveBeenCalled();
  });

  it("answers a kid with expenses on and a parent", async () => {
    vi.stubEnv("FAMILY_ENABLED", "true");
    repositories.family.membership = aKid({ permissions: { expenses: "edit", investments: "off", net_worth: "off", family_finance: "off", mcp: "off", ai: "off" } });
    expect((await get("fu")).status).toBe(200);
    repositories.family.membership = aParent();
    expect((await get("fu")).status).toBe(200);
  });

  it("reports a storage failure with its own message", async () => {
    vi.spyOn(repositories.expenses, "recentDescriptions").mockRejectedValue(new Error("private failure"));

    expect(await get("fu")).toMatchObject({ status: 500, body: { error: "Unable to load suggestions." } });
  });
});
