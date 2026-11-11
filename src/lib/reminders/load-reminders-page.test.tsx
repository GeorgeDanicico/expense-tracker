// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAuthenticatedUser } from "@/lib/auth";
import { REMINDERS_API_KEY, type RemindersResponse } from "@/lib/api/keys";
import { forgetLastActive } from "@/lib/family/last-active";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";
import { loggedLines } from "@/test/log-lines";
import { mountServerPage, serverRender, type ServerRender } from "@/test/mount-server-page";
import { callRoute, signedInAs, testUser } from "@/test/route";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/reminders",
}));
vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn(), asPageCaller: (fn: () => Promise<unknown>) => fn() }));
vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));
const logged = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/log", async (importOriginal) => (await import("@/test/log-lines")).memoryLogModule(await importOriginal(), logged));

import RemindersPage from "@/app/(app)/reminders/page";
import { GET as remindersRoute } from "@/app/api/reminders/route";

// 4 Nov 2026, 11:00 in Bucharest.
const NOW = new Date("2026-11-04T09:00:00Z");

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
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function seedReminder() {
  signedInAs(testUser);
  repositories.reminders.seed({ title: "Water the plants", startsOn: "2026-11-04", nextDueOn: "2026-11-04", nextDueAt: "2026-11-04T15:00:00.000Z" });
}

const renderPage = () => serverRender(RemindersPage);

async function mount(rendered: ServerRender) {
  const mounted = await mountServerPage(rendered, asked);
  cleanup = mounted.unmount;
  return mounted;
}

describe("Reminders' first data on the server (PF7)", () => {
  it("starts the list under the key the page asks for, and the browser asks for nothing", async () => {
    seedReminder();
    const rendered = await renderPage();

    expect(Object.keys(rendered.fallback)).toEqual([REMINDERS_API_KEY]);
    const { container } = await mount(rendered);

    expect(container.textContent).toContain("Water the plants");
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(asked).toEqual([]);
  });

  it("answers exactly as the API route does", async () => {
    seedReminder();
    const { fallback } = await renderPage();

    const response = await callRoute(remindersRoute, { url: REMINDERS_API_KEY });
    expect(response.status).toBe(200);
    expect(await fallback[REMINDERS_API_KEY]).toEqual(response.body);
  });

  it("marks a reminder done right after a cold load: the list changes at once, from the server's copy", async () => {
    seedReminder();
    const fetched = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetched);
    const { container, cache } = await mount(await renderPage());
    expect((cache.get(REMINDERS_API_KEY) as { data?: RemindersResponse } | undefined)?.data?.reminders).toHaveLength(1);

    const done = container.querySelector<HTMLElement>('[aria-label="Mark Water the plants done"]');
    expect(done).not.toBeNull();
    await act(async () => { done?.click(); });

    expect(String((fetched.mock.calls as unknown[][])[0]?.[0])).toMatch(/\/api\/reminders\/.+\/complete$/);
    expect(container.textContent).not.toContain("No reminders yet");
    expect(container.querySelector('[aria-label="Mark Water the plants done"]')).toBeNull();
    vi.unstubAllGlobals();
  });

  it("starts nothing without a session", async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    expect((await renderPage()).fallback).toEqual({});
  });

  it("leaves the list to the browser when its load failed, and logs it without the data", async () => {
    seedReminder();
    vi.spyOn(repositories.reminders, "list").mockRejectedValue(new Error("connection reset"));
    const rendered = await renderPage();

    expect(await rendered.fallback[REMINDERS_API_KEY]).toBeUndefined();
    expect(loggedLines(logged, "server_prefetch_failed")).toEqual([
      expect.objectContaining({ level: "error", route: "/reminders", api: "/api/reminders" }),
    ]);
    expect(logged.join("\n")).not.toContain("Water the plants");
    await mount(rendered);
    expect(asked).toEqual([REMINDERS_API_KEY]);
  });
});
