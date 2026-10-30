import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBucharestMonth } from "@/lib/calendar";
import { forgetLastActive } from "@/lib/family/last-active";
import { PARENT_PERMISSIONS, type CurrentMember, type FamilyData } from "@/lib/family/repository";
import { MEMBER_NOT_FOUND_MESSAGE } from "@/lib/family/viewed-user";
import type { Permissions } from "@/lib/permissions";
import { aFamily, aKid, aParent, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { signedInAs, testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("@/lib/investments/quotes/get-adapter", () => ({
  getInvestmentQuoteAdapter: () => ({ getQuotes: async () => new Map() }),
}));

import { GET as getDashboard } from "@/app/api/dashboard/route";
import { GET as getTabs } from "@/app/api/expense-tabs/route";
import { GET as getExpenses } from "@/app/api/expenses/route";

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

// The Smiths: Mara (the signed-in parent, EUR), Dan (the other parent, EUR) and the kids Ana (RON) and Ion (USD).
const MARA = { memberId: "60000000-0000-4000-8000-000000000001", userId: testUser.id };
const DAN = { memberId: "60000000-0000-4000-8000-000000000003", userId: "10000000-0000-4000-8000-000000000003" };
const ANA = { memberId: "60000000-0000-4000-8000-000000000002", userId: "10000000-0000-4000-8000-000000000002" };
const ION = { memberId: "60000000-0000-4000-8000-000000000004", userId: "10000000-0000-4000-8000-000000000004" };

const finance = (family_finance: Permissions["family_finance"]): Permissions =>
  ({ expenses: "edit", investments: "edit", net_worth: "edit", family_finance, mcp: "off", ai: "off" });

function smiths(): FamilyData {
  const base = aFamily();
  const entry = (member: typeof DAN, role: "parent" | "kid", displayName: string, currency: string) => ({
    ...base.members[0], ...member, role, isCreator: false, displayName, currency,
    permissions: role === "parent" ? PARENT_PERMISSIONS : finance("off"),
  });
  return {
    family: base.family,
    members: [
      { ...base.members[0], displayName: "Mara", currency: "EUR" },
      entry(DAN, "parent", "Dan", "EUR"),
      entry(ANA, "kid", "Ana", "RON"),
      entry(ION, "kid", "Ion", "USD"),
    ],
  };
}

const THIS_MONTH = getBucharestMonth();
const FAMILY_MONTH = `/api/expenses?month=${THIS_MONTH}&context=main&member=all`;

let repositories: FakeRepositories;

async function call(handler: Handler, url: string) {
  const request = new NextRequest(new URL(url, "http://localhost"));
  const response = await handler(request, { params: Promise.resolve({ id: "" }) });
  return { status: response.status, body: await response.json() };
}

function signInAs(userId: string, membership: CurrentMember | null) {
  signedInAs({ id: userId, email: `${userId}@example.test` });
  repositories.family.membership = membership;
}

function spend(userId: string, id: string, description: string, amount: number, day = "01") {
  const existing = repositories.expenses.expenses.get(userId) ?? [];
  repositories.expenses.expenses.set(userId, [
    ...existing,
    anExpense({ id, description, amount, expenseDate: `${THIS_MONTH}-${day}` }),
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  repositories = resetFakeRepositories();
  forgetLastActive();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.family = smiths();
  signInAs(MARA.userId, aParent());
  spend(MARA.userId, "e1", "Mara lunch", 30, "03");
  spend(DAN.userId, "e2", "Dan fuel", 70, "05");
  spend(ANA.userId, "e3", "Ana books", 120, "02");
  spend(ION.userId, "e4", "Ion games", 15.5, "04");
  spend("10000000-0000-4000-8000-000000000099", "e5", "Stranger", 999);
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/expenses?member=all", () => {
  it("combines every member's month, newest first, labelled with the member and their currency", async () => {
    const { status, body } = await call(getExpenses as Handler, FAMILY_MONTH);

    expect(status).toBe(200);
    expect(body.expenses.map((e: Record<string, unknown>) => [e.description, e.memberName, e.currency])).toEqual([
      ["Dan fuel", "Dan", "EUR"],
      ["Ion games", "Ion", "USD"],
      ["Mara lunch", "Mara", "EUR"],
      ["Ana books", "Ana", "RON"],
    ]);
    expect(JSON.stringify(body)).not.toContain("Stranger");
  });

  it("groups the totals by currency and adds nothing across them", async () => {
    const { body } = await call(getExpenses as Handler, FAMILY_MONTH);

    expect(body.totals).toEqual([
      { currency: "RON", total: 120, count: 1, average: 120, largest: 120 },
      { currency: "EUR", total: 100, count: 2, average: 50, largest: 70 },
      { currency: "USD", total: 15.5, count: 1, average: 15.5, largest: 15.5 },
    ]);
    expect(body).not.toHaveProperty("total");
  });

  it("says it is read-only and shows everyone", async () => {
    const { body } = await call(getExpenses as Handler, FAMILY_MONTH);

    expect(body.viewing).toEqual({ memberId: "all", displayName: null, currency: null, readOnly: true });
    expect(body).toMatchObject({ month: THIS_MONTH, effectiveMonth: THIS_MONTH });
  });

  it("reads each member through the repository and nobody else", async () => {
    const listMonth = vi.spyOn(repositories.expenses, "listMonth");

    await call(getExpenses as Handler, FAMILY_MONTH);

    expect(listMonth.mock.calls.map(([userId]) => userId).sort()).toEqual(
      [MARA.userId, DAN.userId, ANA.userId, ION.userId].sort(),
    );
  });

  it("lets a kid with family finance see the family", async () => {
    signInAs(ANA.userId, aKid({ memberId: ANA.memberId, permissions: finance("view") }));

    const { status, body } = await call(getExpenses as Handler, FAMILY_MONTH);

    expect(status).toBe(200);
    expect(body.expenses).toHaveLength(4);
  });

  it("answers 404 to a kid without family finance, without reading anything", async () => {
    signInAs(ANA.userId, aKid({ memberId: ANA.memberId, permissions: finance("off") }));
    const listMonth = vi.spyOn(repositories.expenses, "listMonth");

    expect(await call(getExpenses as Handler, FAMILY_MONTH)).toMatchObject({
      status: 404,
      body: { error: MEMBER_NOT_FOUND_MESSAGE },
    });
    expect(listMonth).not.toHaveBeenCalled();
  });

  it("answers 404 without a family, and while the flag is off", async () => {
    signInAs(MARA.userId, null);
    expect((await call(getExpenses as Handler, FAMILY_MONTH)).status).toBe(404);

    signInAs(MARA.userId, aParent());
    vi.stubEnv("FAMILY_ENABLED", "false");
    expect((await call(getExpenses as Handler, FAMILY_MONTH)).status).toBe(404);
  });

  it("is not for the other finance reads: saved tabs still answer 404 to it", async () => {
    expect((await call(getTabs as Handler, "/api/expense-tabs?member=all")).status).toBe(404);
  });
});

describe("GET /api/dashboard?member=all", () => {
  it("combines this month per currency and lists each member's share", async () => {
    const { status, body } = await call(getDashboard as Handler, "/api/dashboard?member=all");

    expect(status).toBe(200);
    expect(body.currentMonth).toBe(THIS_MONTH);
    expect(body.totals).toEqual([
      { currency: "RON", total: 120, count: 1, average: 120, largest: 120 },
      { currency: "EUR", total: 100, count: 2, average: 50, largest: 70 },
      { currency: "USD", total: 15.5, count: 1, average: 15.5, largest: 15.5 },
    ]);
    expect(body.members).toMatchObject([
      { memberId: MARA.memberId, name: "Mara", currency: "EUR", total: 30, count: 1 },
      { memberId: DAN.memberId, name: "Dan", currency: "EUR", total: 70, count: 1 },
      { memberId: ANA.memberId, name: "Ana", currency: "RON", total: 120, count: 1 },
      { memberId: ION.memberId, name: "Ion", currency: "USD", total: 15.5, count: 1 },
    ]);
    for (const member of body.members) {
      expect(member.series.at(-1)).toMatchObject({ key: THIS_MONTH, total: member.total });
      expect(member.categoryTotals).toEqual(expect.any(Array));
    }
    expect(body.viewing).toEqual({ memberId: "all", displayName: null, currency: null, readOnly: true });
  });

  it("lists the family's newest expenses with their owners", async () => {
    const { body } = await call(getDashboard as Handler, "/api/dashboard?member=all");

    expect(body.currentExpenses.map((e: Record<string, unknown>) => [e.description, e.memberName])).toEqual([
      ["Dan fuel", "Dan"],
      ["Ion games", "Ion"],
      ["Mara lunch", "Mara"],
      ["Ana books", "Ana"],
    ]);
  });

  it("answers 404 to a kid without family finance", async () => {
    signInAs(ION.userId, aKid({ memberId: ION.memberId, permissions: finance("off") }));

    expect(await call(getDashboard as Handler, "/api/dashboard?member=all")).toMatchObject({
      status: 404,
      body: { error: MEMBER_NOT_FOUND_MESSAGE },
    });
  });

  it("leaves the response without the parameter as it was", async () => {
    const { body } = await call(getDashboard as Handler, "/api/dashboard");

    expect(body).toMatchObject({ currentTotal: 30, currentCount: 1 });
    expect(body).not.toHaveProperty("totals");
  });
});
