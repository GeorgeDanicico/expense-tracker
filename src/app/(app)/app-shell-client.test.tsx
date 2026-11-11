// @vitest-environment happy-dom
import { ChakraProvider } from "@chakra-ui/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import { useAccount } from "@/hooks/use-account";
import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";

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
async function mount(cache = new Map()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChakraProvider value={ledgerSystem}>
        <SWRConfig value={{ provider: () => cache, fetcher: (key: string) => { asked.push(key); return fetcher(key); } }}>
          <AppShellClient account={account}>
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

beforeEach(() => {
  // A page loaded a moment ago (the window is measured from the page's start, not the test run's).
  vi.spyOn(performance, "now").mockReturnValue(1_000);
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

  it("asks again, as before, once the server's copy is older than the dedupe window", async () => {
    vi.spyOn(performance, "now").mockReturnValue(20_000);
    fetcher = async () => account;

    await mount();

    expect(asked).toContain(ACCOUNT_API_KEY);
  });

  it("prefers an answer SWR already has over the server's copy", async () => {
    // Another account signed in on this tab since the page was rendered: the browser's cache holds it.
    const cache = new Map();
    fetcher = async (key) => (key === ACCOUNT_API_KEY ? { ...account, signInName: "sam@example.com" } : new Promise(() => undefined));
    const clock = vi.spyOn(performance, "now").mockReturnValue(20_000);
    await mount(cache);
    cleanup?.();
    clock.mockReturnValue(1_000);

    const page = await mount(cache);

    expect(page.querySelector('[data-testid="page"]')?.textContent).toBe("sam@example.com pays in RON");
  });

  it("sends the browser to choose a new password when a reloaded account says it must", async () => {
    const cache = new Map();
    fetcher = async (key) => (key === ACCOUNT_API_KEY ? { ...account, mustChangePassword: true } : new Promise(() => undefined));
    vi.spyOn(performance, "now").mockReturnValue(20_000);

    await mount(cache);

    expect(reload).toHaveBeenCalledWith("/change-password");
  });
});
