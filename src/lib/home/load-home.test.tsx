// @vitest-environment happy-dom
import { ChakraProvider } from "@chakra-ui/react";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import { getAuthenticatedUser } from "@/lib/auth";
import { ACCOUNT_API_KEY, homeDashboardApiKey, REMINDERS_API_KEY, TODOS_API_KEY } from "@/lib/api/keys";
import { forgetLastActive } from "@/lib/family/last-active";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";
import { aFamily, aFamilyMember, aKid, aParent, anExpense } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { loggedLines } from "@/test/log-lines";
import { callRoute, signedInAs, testUser } from "@/test/route";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), asPageCaller: (fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import DashboardPage from "@/app/(app)/dashboard/page";
import { GET as dashboardRoute } from "@/app/api/dashboard/route";
import { GET as remindersRoute } from "@/app/api/reminders/route";
import { GET as todosRoute } from "@/app/api/todos/route";
import { loadPageAccount } from "@/lib/account/load-account";
import { loadHomeFallback } from "@/lib/home/load-home";

// 4 Nov 2026, 11:00 in Bucharest.
const NOW = new Date("2026-11-04T09:00:00Z");
const KID_ID = "10000000-0000-4000-8000-000000000002";

let repositories: FakeRepositories;
let asked: string[];
let cleanup: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // A page loaded a moment ago, so the server's copies count as fresh.
  vi.spyOn(performance, "now").mockReturnValue(1_000);
  repositories = resetFakeRepositories();
  forgetLastActive();
  logged.length = 0;
  asked = [];
  vi.stubEnv("FAMILY_ENABLED", "true");
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** The parent's family, with an expense this month, a reminder due today and a card assigned to them. */
function seedParent() {
  signedInAs(testUser);
  repositories.family.membership = aParent();
  repositories.family.family = aFamily();
  repositories.account.currencies.set(testUser.id, "RON");
  repositories.expenses.expenses.set(testUser.id, [anExpense({ id: "e1", description: "Corner bakery", amount: 42.5, expenseDate: "2026-11-03" })]);
  repositories.reminders.seed({ title: "Water the plants", startsOn: "2026-11-04", nextDueOn: "2026-11-04", nextDueAt: "2026-11-04T15:00:00.000Z" });
  repositories.todos.seed({ title: "Fix the gate", assigneeMemberId: aParent().memberId });
}

/** The kid of that family, with an expense of their own, a reminder and a card. */
function seedKid(permissions = DEFAULT_KID_PERMISSIONS) {
  signedInAs({ id: KID_ID, email: "kid@kids.example.test" });
  repositories.family.membership = aKid({ permissions });
  repositories.family.family = { ...aFamily(), members: [...aFamily().members, aFamilyMember({ permissions })] };
  repositories.expenses.expenses.set(KID_ID, [anExpense({ id: "k1", description: "Comic book", amount: 7.25, expenseDate: "2026-11-02" })]);
  repositories.reminders.callerId = KID_ID;
  repositories.reminders.seed({ title: "Homework", userId: KID_ID, startsOn: "2026-11-04", nextDueOn: "2026-11-04", nextDueAt: "2026-11-04T15:00:00.000Z" });
  repositories.todos.seed({ title: "Tidy the room", assigneeMemberId: aKid().memberId });
}

/** What Home's server render produces: the layout's account, and the page with its fallback (promises). */
async function serverRender() {
  const account = await loadPageAccount();
  const page = (await DashboardPage()) as ReactElement<{ fallback: Record<string, Promise<unknown>> }>;
  return { account, page, fallback: page.props.fallback };
}

/** Each fallback promise's answer. */
async function settled(fallback: Record<string, Promise<unknown>>) {
  return Object.fromEntries(await Promise.all(Object.entries(fallback).map(async ([key, promise]) => [key, await promise] as const)));
}

/** Home in the browser as the server sent it: the account in the layout's fallback, the page under it, and a fetcher that records every key asked. */
async function mountHome({ account, page }: Awaited<ReturnType<typeof serverRender>>, cache = new Map()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChakraProvider value={ledgerSystem}>
        <SWRConfig value={{ provider: () => cache, fetcher: (key: string) => { asked.push(key); return new Promise(() => undefined); } }}>
          <SWRConfig value={{ fallback: { [ACCOUNT_API_KEY]: account } }}>{page}</SWRConfig>
        </SWRConfig>
      </ChakraProvider>,
    );
  });
  // SWR revalidates a mounted key with data on the next animation frame: give it time to.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  return { container, cache };
}

describe("Home's first data on the server (PF6)", () => {
  it("starts the month, the reminders and the board for a parent, under the keys the blocks ask for, and the browser asks for none of them", async () => {
    seedParent();
    const render = await serverRender();
    const { fallback } = render;

    expect(Object.keys(fallback).sort()).toEqual([homeDashboardApiKey(), REMINDERS_API_KEY, TODOS_API_KEY].sort());
    const { container } = await mountHome(render);

    expect(container.textContent).toMatch(/RON\s42\.50/);
    expect(container.textContent).toContain("Corner bakery");
    expect(container.textContent).toContain("Water the plants");
    expect(container.textContent).toContain("Fix the gate");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(asked).toEqual([]);
  });

  it("answers each key exactly as its API route does", async () => {
    seedParent();
    const answers = await settled((await serverRender()).fallback);

    for (const [key, route] of [[homeDashboardApiKey(), dashboardRoute], [REMINDERS_API_KEY, remindersRoute], [TODOS_API_KEY, todosRoute]] as const) {
      const response = await callRoute(route, { url: key });
      expect(response.status).toBe(200);
      expect(answers[key]).toEqual(response.body);
    }
  });

  it("starts no expense load for a kid without the expenses permission, so none of their expenses reach the page", async () => {
    seedKid({ ...DEFAULT_KID_PERMISSIONS, expenses: "off" });
    const getDashboard = vi.spyOn(repositories.expenses, "getDashboard");
    const render = await serverRender();
    const { fallback } = render;

    expect(Object.keys(fallback).sort()).toEqual([REMINDERS_API_KEY, TODOS_API_KEY].sort());
    expect(getDashboard).not.toHaveBeenCalled();
    expect(JSON.stringify(await settled(fallback))).not.toContain("Comic book");
    expect((await callRoute(dashboardRoute, { url: homeDashboardApiKey() })).status).toBe(403);

    const { container } = await mountHome(render);
    expect(container.textContent).not.toContain("Spent in");
    expect(container.textContent).not.toContain("Comic book");
    expect(container.textContent).toContain("Homework");
    expect(container.textContent).toContain("Tidy the room");
    expect(asked).toEqual([]);
  });

  it("gives a kid with the expenses permission their own month", async () => {
    seedKid();
    const render = await serverRender();
    const { fallback } = render;

    expect(Object.keys(fallback)).toContain(homeDashboardApiKey());
    const { container } = await mountHome(render);
    expect(container.textContent).toContain("Comic book");
    expect(asked).toEqual([]);
  });

  it("starts no board for a user without a family", async () => {
    seedParent();
    repositories.family.membership = null;
    repositories.family.family = null;
    const render = await serverRender();
    const { fallback } = render;

    expect(Object.keys(fallback).sort()).toEqual([homeDashboardApiKey(), REMINDERS_API_KEY].sort());
    const { container } = await mountHome(render);
    expect(container.textContent).not.toContain("To-dos for you");
    expect(asked).toEqual([]);
  });

  it("starts nothing without a session (the layout sends that visitor to sign in)", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect(await loadHomeFallback()).toEqual({});
  });

  it("leaves a block whose load failed to the browser, and logs the failure without the data", async () => {
    seedParent();
    vi.spyOn(repositories.reminders, "list").mockRejectedValue(new Error("connection reset"));
    const render = await serverRender();
    const { fallback } = render;

    expect(await fallback[REMINDERS_API_KEY]).toBeUndefined();
    expect(loggedLines(logged, "server_prefetch_failed")).toEqual([
      expect.objectContaining({ level: "error", route: "/dashboard", api: "/api/reminders", error: expect.objectContaining({ message: "connection reset" }) }),
    ]);
    expect(logged.join("\n")).not.toContain("Corner bakery");

    const { container } = await mountHome(render);
    expect(asked).toEqual([REMINDERS_API_KEY]);
    expect(container.textContent).toContain("Corner bakery");
    // The reminders wait for the browser's own request, in their loading card.
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
  });
});
