import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forgetLastActive } from "@/lib/family/last-active";
import { PARENT_PERMISSIONS, type CurrentMember, type FamilyData } from "@/lib/family/repository";
import { MEMBER_NOT_FOUND_MESSAGE } from "@/lib/family/viewed-user";
import type { Permissions } from "@/lib/permissions";
import { aFamily, aKid, aManualItem, aParent, aTransaction, aValuation } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { signedInAs, testUser } from "@/test/route";

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
vi.mock("@/lib/investments/quotes/get-adapter", () => ({
  getInvestmentQuoteAdapter: () => ({ getQuotes: async () => new Map() }),
}));

import { GET as getInvestments } from "@/app/api/investments/route";
import { GET as getNetWorth } from "@/app/api/net-worth/route";

type Handler = (request: NextRequest, context: { params: Promise<{ id: string }> }) => Promise<Response>;

// A family of three: Mara (the signed-in parent, EUR), Dan (a parent, EUR) and the kid Ana (RON).
const MARA = { memberId: "60000000-0000-4000-8000-000000000001", userId: testUser.id };
const DAN = { memberId: "60000000-0000-4000-8000-000000000003", userId: "10000000-0000-4000-8000-000000000003" };
const ANA = { memberId: "60000000-0000-4000-8000-000000000002", userId: "10000000-0000-4000-8000-000000000002" };
const STRANGER = "10000000-0000-4000-8000-000000000099";

const finance = (family_finance: Permissions["family_finance"]): Permissions =>
  ({ expenses: "edit", investments: "edit", net_worth: "edit", family_finance, mcp: "off", ai: "off" });

function threeOfThem(): FamilyData {
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
    ],
  };
}

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

function holdShares(userId: string, accountId: string, instrument: string, currency: string) {
  repositories.investments.accounts.push({ id: accountId, userId, brokerId: "xtb" });
  repositories.investments.transactions.push(
    aTransaction({ id: `${accountId}-buy`, investmentAccountId: accountId, instrument, currency }),
  );
}

function ownItem(userId: string, id: string, name: string, currency: string, value: string, kind: "asset" | "liability" = "asset") {
  repositories.netWorth.seed(userId, aManualItem({
    id, name, currency, kind, category: kind === "asset" ? "cash" : "debt",
    valuations: [aValuation({ id: `${id}-v`, itemId: id, value })],
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  repositories = resetFakeRepositories();
  forgetLastActive();
  vi.stubEnv("FAMILY_ENABLED", "true");
  repositories.family.family = threeOfThem();
  signInAs(MARA.userId, aParent());

  holdShares(MARA.userId, "acct-mara", "VWCE.DE", "EUR");
  holdShares(ANA.userId, "acct-ana", "TVBETETF.RO", "RON");
  holdShares(STRANGER, "acct-stranger", "SECRET", "USD");

  ownItem(MARA.userId, "m1", "Mara savings", "EUR", "1000");
  ownItem(MARA.userId, "m2", "Mara loan", "EUR", "250", "liability");
  ownItem(DAN.userId, "d1", "Dan savings", "EUR", "500");
  ownItem(ANA.userId, "a1", "Ana piggy bank", "RON", "300");
  ownItem(STRANGER, "s1", "Stranger fortune", "EUR", "999999");
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/investments?member=all", () => {
  it("returns one overview per member, in family order, and nobody else's", async () => {
    const { status, body } = await call(getInvestments as Handler, "/api/investments?member=all");

    expect(status).toBe(200);
    expect(body.members.map((m: { name: string; currency: string }) => [m.name, m.currency])).toEqual([
      ["Mara", "EUR"], ["Dan", "EUR"], ["Ana", "RON"],
    ]);
    const instruments = (name: string) =>
      body.members.find((m: { name: string }) => m.name === name).overview.brokers.flatMap(
        (broker: { assets: Array<{ instrument: string }> }) => broker.assets.map((asset) => asset.instrument),
      );
    expect(instruments("Mara")).toEqual(["VWCE.DE"]);
    expect(instruments("Dan")).toEqual([]);
    expect(instruments("Ana")).toEqual(["TVBETETF.RO"]);
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });

  it("says it is read-only and shows everyone", async () => {
    const { body } = await call(getInvestments as Handler, "/api/investments?member=all");

    expect(body.viewing).toEqual({ memberId: "all", displayName: null, currency: null, readOnly: true });
    expect(body).not.toHaveProperty("brokers");
  });

  it("reads each member through the repository and nobody else", async () => {
    const list = vi.spyOn(repositories.investments, "listAccountsWithTransactions");

    await call(getInvestments as Handler, "/api/investments?member=all");

    expect(list.mock.calls.map(([userId]) => userId).sort()).toEqual([MARA.userId, DAN.userId, ANA.userId].sort());
  });

  it("answers 404 to a kid without family finance, without reading anything", async () => {
    signInAs(ANA.userId, aKid({ memberId: ANA.memberId, permissions: finance("off") }));
    const list = vi.spyOn(repositories.investments, "listAccountsWithTransactions");

    expect(await call(getInvestments as Handler, "/api/investments?member=all")).toMatchObject({
      status: 404, body: { error: MEMBER_NOT_FOUND_MESSAGE },
    });
    expect(list).not.toHaveBeenCalled();
  });

  it("lets a kid with family finance see the family", async () => {
    signInAs(ANA.userId, aKid({ memberId: ANA.memberId, permissions: finance("view") }));

    expect((await call(getInvestments as Handler, "/api/investments?member=all")).body.members).toHaveLength(3);
  });

  it("answers 404 without a family, and while the flag is off", async () => {
    signInAs(MARA.userId, null);
    expect((await call(getInvestments as Handler, "/api/investments?member=all")).status).toBe(404);

    signInAs(MARA.userId, aParent());
    vi.stubEnv("FAMILY_ENABLED", "false");
    expect((await call(getInvestments as Handler, "/api/investments?member=all")).status).toBe(404);
  });

  it("leaves the response without the parameter as it was", async () => {
    const { body } = await call(getInvestments as Handler, "/api/investments");

    expect(body.brokers).toHaveLength(1);
    expect(body).not.toHaveProperty("members");
  });
});

describe("GET /api/net-worth?member=all", () => {
  it("returns each member's balance sheet and nobody else's", async () => {
    const { status, body } = await call(getNetWorth as Handler, "/api/net-worth?member=all");

    expect(status).toBe(200);
    const names = (name: string) =>
      body.members.find((m: { name: string }) => m.name === name).overview.entries.map((e: { name: string }) => e.name);
    expect(names("Mara")).toContain("Mara savings");
    expect(names("Dan")).toEqual(["Dan savings"]);
    expect(names("Ana")).toContain("Ana piggy bank");
    expect(JSON.stringify(body)).not.toContain("Stranger");
    expect(body.viewing).toEqual({ memberId: "all", displayName: null, currency: null, readOnly: true });
  });

  it("adds the members' totals per currency and converts nothing", async () => {
    const { body } = await call(getNetWorth as Handler, "/api/net-worth?member=all");

    const eur = body.totalsByCurrency.find((t: { currency: string }) => t.currency === "EUR");
    expect(eur).toMatchObject({ assets: "1500", liabilities: "250", knownSubtotal: "1250" });
    expect(body.totalsByCurrency.find((t: { currency: string }) => t.currency === "RON")).toMatchObject({ assets: "300" });
    expect(body.totalsByCurrency.map((t: { currency: string }) => t.currency)).toEqual(["EUR", "RON"]);
  });

  it("answers 404 to a kid without family finance", async () => {
    signInAs(ANA.userId, aKid({ memberId: ANA.memberId, permissions: finance("off") }));

    expect(await call(getNetWorth as Handler, "/api/net-worth?member=all")).toMatchObject({
      status: 404, body: { error: MEMBER_NOT_FOUND_MESSAGE },
    });
  });

  it("answers 404 while the flag is off", async () => {
    vi.stubEnv("FAMILY_ENABLED", "false");

    expect((await call(getNetWorth as Handler, "/api/net-worth?member=all")).status).toBe(404);
  });

  it("leaves the response without the parameter as it was", async () => {
    const { body } = await call(getNetWorth as Handler, "/api/net-worth");

    expect(body).toHaveProperty("entries");
    expect(body).not.toHaveProperty("members");
  });
});
