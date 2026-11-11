// @vitest-environment happy-dom
import { ChakraProvider } from "@chakra-ui/react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntentLink } from "@/components/layout/intent-link";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { SettingsList, settingsGroups } from "@/components/settings/settings-nav";
import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY, REMINDERS_SUMMARY_API_KEY } from "@/lib/api/keys";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A link that shows the prefetch setting it was given: `undefined` is Next's default (prefetch when it is on screen).
vi.mock("next/link", () => ({
  default: ({ prefetch, href, children, ...rest }: { prefetch?: boolean | null; href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} data-prefetch={String(prefetch)} {...rest}>{children}</a>
  ),
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const account: AccountData = {
  email: "a@b.c",
  signInName: "a@b.c",
  currency: "EUR",
  features: { family: true },
  membership: { memberId: "m1", role: "parent", isCreator: false, familyName: "Popescu", permissions: PARENT_PERMISSIONS },
  mustChangePassword: false,
  avatarUrl: null,
};

let cleanup: (() => void) | null = null;

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChakraProvider value={ledgerSystem}>
        <SWRConfig value={{ provider: () => new Map(), fetcher: () => new Promise(() => {}), fallback: { [ACCOUNT_API_KEY]: account, [REMINDERS_SUMMARY_API_KEY]: { due: 0, overdue: 0 } } }}>
          {node}
        </SWRConfig>
      </ChakraProvider>,
    );
  });
  cleanup = () => { act(() => root.unmount()); container.remove(); };
  return container;
}

/** `href=setting` for each link in `container`. */
const prefetchOf = (container: HTMLElement) => Object.fromEntries([...container.querySelectorAll("a")].map((a) => [a.getAttribute("href"), a.dataset.prefetch]));

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe("IntentLink", () => {
  it("is not prefetched until someone points at it, then is (hover, focus or touch)", async () => {
    for (const event of [new Event("pointerover", { bubbles: true }), new Event("focusin", { bubbles: true }), new Event("touchstart", { bubbles: true })]) {
      const container = await mount(<IntentLink href="/settings">Settings</IntentLink>);
      const link = container.querySelector("a")!;
      expect(link.dataset.prefetch).toBe("false");

      await act(async () => { link.dispatchEvent(event); });

      expect(link.dataset.prefetch).toBe("null");
      cleanup?.();
    }
  });

  it("still calls the handlers it was given", async () => {
    const onTouchStart = vi.fn();
    const container = await mount(<IntentLink href="/more" onTouchStart={onTouchStart}>More</IntentLink>);

    await act(async () => { container.querySelector("a")!.dispatchEvent(new Event("touchstart", { bubbles: true })); });

    expect(onTouchStart).toHaveBeenCalledOnce();
  });
});

describe("which navigation links are prefetched when they scroll into view (PF8)", () => {
  it("the sidebar prefetches every page but Settings", async () => {
    const container = await mount(<SidebarNav signInName="a@b.c" />);
    const links = prefetchOf(container);

    expect(links["/settings"]).toBe("false");
    expect(Object.entries(links).filter(([href]) => href !== "/settings").map(([, setting]) => setting)).toEqual(Array(8).fill("undefined"));
  });

  it("the bottom bar prefetches Home, Money and Planning but not More", async () => {
    const container = await mount(<MobileTabBar />);

    expect(prefetchOf(container)).toEqual({ "/dashboard": "undefined", "/expenses": "undefined", "/reminders": "undefined", "/more": "false" });
  });

  it("no page in the settings list is prefetched", async () => {
    const container = await mount(<SettingsList groups={settingsGroups(account)} />);
    const settings = Object.values(prefetchOf(container));

    expect(settings.length).toBeGreaterThan(4);
    expect(new Set(settings)).toEqual(new Set(["false"]));
  });
});
