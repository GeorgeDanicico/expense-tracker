// @vitest-environment happy-dom
import { ChakraProvider } from "@chakra-ui/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import { useAccount } from "@/hooks/use-account";
import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY, ACCOUNT_NOTICES_API_KEY, REMINDERS_SUMMARY_API_KEY, type RemindersSummaryResponse } from "@/lib/api/keys";
import type { ServerFallbackData } from "@/lib/api/server-fallback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/dashboard" }));
const reload = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/auth-redirect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/auth-redirect")>()),
  loadAfterSessionChange: reload,
}));

import { AppShellClient } from "@/app/(app)/app-shell-client";

const account: AccountData = {
  email: "alex@example.com",
  signInName: "alex@example.com",
  currency: "RON",
  features: { family: false },
  membership: null,
  mustChangePassword: false,
  avatarUrl: null,
};

/** A page under the layout that reads the account, as every page does. */
function Page() {
  const { account: current, currency } = useAccount();
  return <p data-testid="page">{`${current?.signInName} pays in ${currency}`}</p>;
}

let asked: string[];
let fetcher: (key: string) => Promise<unknown>;
let cleanup: (() => void) | null = null;

/** The client half of the layout, as the server renders it, with a cache of its own and `fetcher` for every key. */
async function mount(cache = new Map(), fallback: ServerFallbackData = { [REMINDERS_SUMMARY_API_KEY]: Promise.resolve({ due: 2, overdue: 1 }) }, shownAccount = account) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChakraProvider value={ledgerSystem}>
        <SWRConfig value={{ provider: () => cache, fetcher: (key: string) => { asked.push(key); return fetcher(key); } }}>
          <AppShellClient account={shownAccount} fallback={fallback}>
            <Page />
          </AppShellClient>
        </SWRConfig>
      </ChakraProvider>,
    );
  });
  // SWR revalidates a mounted key with data on the next animation frame: give it time to.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  return container;
}

const badges = (page: HTMLElement) => [...page.querySelectorAll("[data-nav-badge]")].map((badge) => badge.textContent);

beforeEach(() => {
  asked = [];
  fetcher = (key) => (key === ACCOUNT_API_KEY ? Promise.reject(new Error("the account was asked for")) : new Promise(() => undefined));
  reload.mockReset();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  vi.restoreAllMocks();
});

describe("the (app) layout in the browser", () => {
  it("shows the shell and the page with the server's account, without asking /api/account", async () => {
    const page = await mount();

    expect(page.querySelector('[data-testid="page"]')?.textContent).toBe("alex@example.com pays in RON");
    expect(page.textContent).toContain("alex@example.com");
    expect(asked).not.toContain(ACCOUNT_API_KEY);
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows the Reminders count the layout started, without asking /api/reminders/summary", async () => {
    const page = await mount();

    expect(badges(page)).toContain("3");
    expect(asked).not.toContain(REMINDERS_SUMMARY_API_KEY);
  });

  it("draws the shell while the count is still on its way, then the count", async () => {
    let arrive: (summary: RemindersSummaryResponse) => void = () => undefined;
    const page = await mount(new Map(), { [REMINDERS_SUMMARY_API_KEY]: new Promise((resolve) => { arrive = resolve; }) });
    expect(page.textContent).toContain("alex@example.com");
    expect(badges(page)).toEqual([]);

    await act(async () => { arrive({ due: 1, overdue: 0 }); });

    expect(badges(page)).toContain("1");
  });

  it("asks for the count itself when the layout couldn't read it", async () => {
    fetcher = async (key) => (key === REMINDERS_SUMMARY_API_KEY ? { due: 4, overdue: 0 } : new Promise(() => undefined));

    const page = await mount(new Map(), { [REMINDERS_SUMMARY_API_KEY]: Promise.resolve(undefined) });

    expect(asked).toContain(REMINDERS_SUMMARY_API_KEY);
    expect(badges(page)).toContain("4");
  });

  it("shows the notice the layout started, without asking /api/account/notices", async () => {
    const notices = { notices: [{ id: "n1", kind: "removed_from_family", familyName: "Smiths", createdAt: "2026-11-01T09:00:00Z" }] };

    await mount(new Map(), { [ACCOUNT_NOTICES_API_KEY]: Promise.resolve(notices) }, { ...account, features: { family: true } });

    expect(document.body.textContent).toContain("You were removed from the family Smiths.");
    expect(asked).not.toContain(ACCOUNT_NOTICES_API_KEY);
  });

  it("doesn't ask for the account again however old the server's copy is: a page opening later reads what is there", async () => {
    vi.spyOn(performance, "now").mockReturnValue(20_000);

    await mount();

    expect(asked).not.toContain(ACCOUNT_API_KEY);
  });

  it("prefers an answer SWR already has over the server's copy", async () => {
    // Another account signed in on this tab since the page was rendered: the browser's cache holds it.
    const cache = new Map([[ACCOUNT_API_KEY, { data: { ...account, signInName: "sam@example.com" } }]]);

    const page = await mount(cache);

    expect(page.querySelector('[data-testid="page"]')?.textContent).toBe("sam@example.com pays in RON");
  });

  it("sends the browser to choose a new password when the account, read again on return, says it must", async () => {
    fetcher = async (key) => (key === ACCOUNT_API_KEY ? { ...account, mustChangePassword: true } : new Promise(() => undefined));
    await mount();
    expect(reload).not.toHaveBeenCalled();

    // SWR ignores a focus within `focusThrottleInterval` (5 s) of the hook mounting.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_000);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

    expect(reload).toHaveBeenCalledWith("/change-password");
  });
});
