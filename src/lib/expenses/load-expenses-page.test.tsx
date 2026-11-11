// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { expenseTabExpensesApiKey, expenseTabsApiKey, FAMILY_API_KEY, mainExpensesApiKey } from "@/lib/api/keys";
import { getAuthenticatedUser } from "@/lib/auth";
import { forgetLastActive } from "@/lib/family/last-active";
import { DEFAULT_EXPENSE_TAB_FILTERS } from "@/lib/expenses/filters";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";
import { aFamily, aFamilyMember, aKid, aParent, anExpense, aTab } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { loggedLines } from "@/test/log-lines";
import { mountServerPage, serverRender, type ServerRender } from "@/test/mount-server-page";
import { callRoute, signedInAs, testUser } from "@/test/route";

const nav = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/expenses",
}));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), asPageCaller: (fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import ExpensesPage from "@/app/(app)/expenses/page";
import { GET as expensesRoute } from "@/app/api/expenses/route";
import { GET as familyRoute } from "@/app/api/family/route";
import { GET as tabLedgerRoute } from "@/app/api/expense-tabs/[id]/expenses/route";
import { GET as tabsRoute } from "@/app/api/expense-tabs/route";

// 4 Nov 2026, 11:00 in Bucharest.
const NOW = new Date("2026-11-04T09:00:00Z");
const KID_ID = "10000000-0000-4000-8000-000000000002";
const KID_MEMBER = aFamilyMember().memberId;
const TAB = aTab({ id: "40000000-0000-4000-8000-000000000001", updatedAt: "2026-10-20T10:00:00.000Z" });

let repositories: FakeRepositories;
let asked: string[];
let cleanup: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(performance, "now").mockReturnValue(1_000);
  repositories = resetFakeRepositories();
  forgetLastActive();
  logged.length = 0;
  asked = [];
  nav.search = "";
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** The parent's family with a kid, expenses of both in November and October, and a saved tab of the parent's. */
function seedParent() {
  signedInAs(testUser);
  repositories.family.membership = aParent();
  repositories.family.family = { ...aFamily(), members: [...aFamily().members, aFamilyMember()] };
  repositories.account.currencies.set(testUser.id, "RON");
  repositories.expenses.expenses.set(testUser.id, [
    anExpense({ id: "e1", description: "Corner bakery", amount: 42.5, expenseDate: "2026-11-03" }),
    anExpense({ id: "e2", description: "October fuel", amount: 200, expenseDate: "2026-10-12" }),
  ]);
  repositories.expenses.expenses.set(KID_ID, [anExpense({ id: "k1", description: "Comic book", amount: 7.25, expenseDate: "2026-11-02" })]);
  repositories.expenseTabs.tabs.set(testUser.id, [TAB]);
}

function seedKid(permissions = DEFAULT_KID_PERMISSIONS) {
  seedParent();
  signedInAs({ id: KID_ID, email: "kid@kids.example.test" });
  repositories.family.membership = aKid({ permissions });
  repositories.family.family = { ...aFamily(), members: [...aFamily().members, aFamilyMember({ permissions })] };
}

/** The page rendered on the server for `?<search>`, then mounted in the browser at that URL. */
async function renderPage(search = "") {
  nav.search = search;
  return serverRender(ExpensesPage, { searchParams: Promise.resolve(Object.fromEntries(new URLSearchParams(search))) });
}

async function mount(rendered: ServerRender) {
  const mounted = await mountServerPage(rendered, asked);
  cleanup = mounted.unmount;
  return mounted;
}

const keysOf = (rendered: ServerRender) => Object.keys(rendered.fallback).sort();
const sorted = (...keys: string[]) => keys.sort();

describe("Expenses' first data on the server (PF7)", () => {
  it("starts the month, the month before and the saved tabs for a parent, and the browser asks for none of them", async () => {
    seedParent();
    const rendered = await renderPage();

    expect(keysOf(rendered)).toEqual([FAMILY_API_KEY, expenseTabsApiKey(null), mainExpensesApiKey("2026-11"), mainExpensesApiKey("2026-10")].sort());
    const { container } = await mount(rendered);

    expect(container.textContent).toContain("Corner bakery");
    expect(container.textContent).toContain("Car");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(asked).toEqual([]);
  });

  it("answers each key exactly as its API route does", async () => {
    seedParent();
    const { fallback } = await renderPage();

    for (const [key, route] of [[mainExpensesApiKey("2026-11"), expensesRoute], [mainExpensesApiKey("2026-10"), expensesRoute], [expenseTabsApiKey(null), tabsRoute]] as const) {
      const response = await callRoute(route, { url: key });
      expect(response.status).toBe(200);
      expect(await fallback[key]).toEqual(response.body);
    }
  });

  it("reads the month from the URL, bringing a future month back to this one", async () => {
    seedParent();

    expect(keysOf(await renderPage("month=2026-10"))).toContain(mainExpensesApiKey("2026-10"));
    expect(keysOf(await renderPage("month=2026-10"))).toContain(mainExpensesApiKey("2026-09"));
    expect(keysOf(await renderPage("month=2027-03"))).toContain(mainExpensesApiKey("2026-11"));
    expect(keysOf(await renderPage("month=nonsense"))).toContain(mainExpensesApiKey("2026-11"));
  });

  it("starts a saved tab's ledger for the filters in the URL, under the key with the tab's revision", async () => {
    seedParent();
    const rendered = await renderPage(`tab=${TAB.id}`);
    const key = expenseTabExpensesApiKey(TAB.id, DEFAULT_EXPENSE_TAB_FILTERS, TAB.updatedAt, null);

    expect(keysOf(rendered)).toEqual([FAMILY_API_KEY, expenseTabsApiKey(null), key].sort());
    const response = await callRoute(tabLedgerRoute, { url: key, params: { id: TAB.id } });
    expect(response.status).toBe(200);
    expect(await rendered.fallback[key]).toEqual(response.body);
    await mount(rendered);
    expect(asked).toEqual([]);
  });

  it("starts no ledger for a tab the person doesn't have", async () => {
    seedParent();

    expect(keysOf(await renderPage("tab=40000000-0000-4000-8000-0000000000ff"))).toEqual(sorted(FAMILY_API_KEY, expenseTabsApiKey(null)));
  });

  it("starts the family's month alone for the family view, which has no saved tabs", async () => {
    seedParent();
    const rendered = await renderPage("member=all");

    expect(keysOf(rendered)).toEqual(sorted(FAMILY_API_KEY, mainExpensesApiKey("2026-11", "all")));
    const response = await callRoute(expensesRoute, { url: mainExpensesApiKey("2026-11", "all") });
    expect(await rendered.fallback[mainExpensesApiKey("2026-11", "all")]).toEqual(response.body);
    const { container } = await mount(rendered);
    expect(container.textContent).toContain("Comic book");
    expect(asked).toEqual([]);
  });

  it("starts another member's months, tabs and the family list for a parent viewing them", async () => {
    seedParent();
    const rendered = await renderPage(`member=${KID_MEMBER}`);

    expect(keysOf(rendered)).toEqual([FAMILY_API_KEY, expenseTabsApiKey(KID_MEMBER), mainExpensesApiKey("2026-11", KID_MEMBER), mainExpensesApiKey("2026-10", KID_MEMBER)].sort());
    for (const [key, route] of [[FAMILY_API_KEY, familyRoute], [mainExpensesApiKey("2026-11", KID_MEMBER), expensesRoute]] as const) {
      expect(await rendered.fallback[key]).toEqual((await callRoute(route, { url: key })).body);
    }
    const { container } = await mount(rendered);
    expect(container.textContent).toContain("Comic book");
    expect(container.textContent).not.toContain("Corner bakery");
    expect(asked).toEqual([]);
  });

  it("treats the person's own member id as themselves", async () => {
    seedParent();

    expect(keysOf(await renderPage(`member=${aParent().memberId}`))).toContain(mainExpensesApiKey("2026-11", null));
  });

  it("starts nothing for a kid with the expenses permission off, so none of their expenses reach the page", async () => {
    seedKid({ ...DEFAULT_KID_PERMISSIONS, expenses: "off" });
    const rendered = await renderPage();

    expect(rendered.fallback).toEqual({});
    const { container } = await mount(rendered);
    expect(container.textContent).toContain("This part of the app is turned off for you");
    expect(container.textContent).not.toContain("Comic book");
    expect(asked).toEqual([]);
  });

  it("gives a kid their own month, but starts nothing for another member's when they may not view it", async () => {
    seedKid();

    expect(keysOf(await renderPage())).toContain(mainExpensesApiKey("2026-11", null));
    const viewing = await renderPage(`member=${aParent().memberId}`);
    expect(viewing.fallback).toEqual({});
    expect(JSON.stringify(viewing.page.props)).not.toContain("Corner bakery");
  });

  it("lets a kid with family finance on view another member", async () => {
    seedKid({ ...DEFAULT_KID_PERMISSIONS, family_finance: "view" });

    expect(keysOf(await renderPage(`member=${aParent().memberId}`))).toContain(mainExpensesApiKey("2026-11", aParent().memberId));
  });

  it("starts nothing without a session", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await renderPage()).fallback).toEqual({});
  });

  it("starts nothing for a member the person can't see (an id outside the family): the load is refused, logged, and left to the browser", async () => {
    seedParent();
    const stranger = "60000000-0000-4000-8000-0000000000aa";
    const rendered = await renderPage(`member=${stranger}`);

    expect(await rendered.fallback[mainExpensesApiKey("2026-11", stranger)]).toBeUndefined();
    expect(loggedLines(logged, "server_prefetch_failed").length).toBeGreaterThan(0);
    expect(logged.join("\n")).not.toContain("Corner bakery");
  });

  it("leaves a month whose load failed to the browser, and logs it without the data", async () => {
    seedParent();
    vi.spyOn(repositories.expenses, "listMonth").mockRejectedValue(new Error("connection reset"));
    const rendered = await renderPage();

    expect(await rendered.fallback[mainExpensesApiKey("2026-11")]).toBeUndefined();
    expect(loggedLines(logged, "server_prefetch_failed")).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", route: "/expenses", api: "/api/expenses" }),
    ]));
    expect(logged.join("\n")).not.toContain("Corner bakery");
    await mount(rendered);
    expect(asked).toContain(mainExpensesApiKey("2026-11"));
  });
});
