// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

// The sheet's module: the factory runs when the module is first imported, so the count says when the browser asked for it.
const loads = vi.hoisted(() => ({ count: 0 }));

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
let runIdle: (() => void) | null = null;
const original = { idle: window.requestIdleCallback, cancel: window.cancelIdleCallback };

beforeEach(() => {
  runIdle = null;
  loads.count = 0;
  vi.spyOn(document, "readyState", "get").mockReturnValue("complete");
  window.requestIdleCallback = ((callback: () => void) => {
    runIdle = callback;
    return 1;
  }) as typeof window.requestIdleCallback;
  window.cancelIdleCallback = (() => undefined) as typeof window.cancelIdleCallback;
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  window.requestIdleCallback = original.idle;
  window.cancelIdleCallback = original.cancel;
  vi.restoreAllMocks();
});

/** The provider with a page that has not loaded the sheet: modules (and React) are loaded again, so the sheet's module is not cached. */
async function mount() {
  vi.resetModules();
  vi.doMock("./quick-add-sheet", () => {
    loads.count += 1;
    return { QuickAddSheet: ({ open }: { open: boolean }) => <p data-testid="sheet">{open ? "open" : "closed"}</p> };
  });
  const [{ ChakraProvider }, react, client, swr, theme, provider] = await Promise.all([
    import("@chakra-ui/react"),
    import("react"),
    import("react-dom/client"),
    import("swr"),
    import("@/components/ui/theme"),
    import("./quick-add-provider"),
  ]);
  const { act } = react;
  function Opener() {
    const quickAdd = provider.useQuickAdd();
    return (
      <button type="button" onClick={() => quickAdd.open()} onPointerEnter={quickAdd.preload}>
        Add
      </button>
    );
  }
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = client.createRoot(container);
  await act(async () => {
    root.render(
      <ChakraProvider value={theme.ledgerSystem}>
        <swr.SWRConfig value={{ provider: () => new Map(), fetcher: () => new Promise(() => {}), fallback: { [ACCOUNT_API_KEY]: account } }}>
          <provider.QuickAddProvider>
            <Opener />
          </provider.QuickAddProvider>
        </swr.SWRConfig>
      </ChakraProvider>,
    );
  });
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { container, act };
}

describe("the quick-add sheet's script (PF9)", () => {
  it("is not asked for while the page loads, and the sheet is not on the page", async () => {
    const { container } = await mount();
    expect(loads.count).toBe(0);
    expect(container.querySelector('[data-testid="sheet"]')).toBeNull();
  });

  it("is asked for when the browser is idle, before anyone taps +", async () => {
    const { act } = await mount();
    expect(runIdle).not.toBeNull();
    await act(async () => {
      runIdle?.();
    });
    await vi.waitFor(() => expect(loads.count).toBe(1));
  });

  it("is asked for when the pointer reaches the button, and not before", async () => {
    const { container, act } = await mount();
    expect(loads.count).toBe(0);
    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    await vi.waitFor(() => expect(loads.count).toBe(1));
  });

  it("puts the sheet on the page, open, when + is tapped", async () => {
    const { container, act } = await mount();
    await act(async () => container.querySelector("button")?.click());
    await vi.waitFor(() => expect(container.querySelector('[data-testid="sheet"]')?.textContent).toBe("open"));
    expect(loads.count).toBe(1);
  });
});
