// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The menu's code is loaded once per page (PF9) and stays loaded, so each test starts from a page that has not
 * loaded it: the modules, React among them, are loaded again.
 */
async function fresh() {
  vi.resetModules();
  const [{ ChakraProvider }, react, client, chipMenu, iconButton, lazyMenu, theme] = await Promise.all([
    import("@chakra-ui/react"),
    import("react"),
    import("react-dom/client"),
    import("@/components/ui/chip-menu"),
    import("@/components/ui/icon-button"),
    import("@/components/ui/lazy-menu"),
    import("@/components/ui/theme"),
  ]);
  const { act } = react;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = client.createRoot(container);
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  async function mount(node: React.ReactNode) {
    await act(async () => {
      root.render(<ChakraProvider value={theme.ledgerSystem}>{node}</ChakraProvider>);
    });
    return container;
  }
  return { act, mount, ChipMenu: chipMenu.ChipMenu, IconButton: iconButton.IconButton, loadMenuParts: lazyMenu.loadMenuParts };
}

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

const items = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }];
const trigger = (container: HTMLElement, scope: "menu" | "tooltip") => container.querySelector(`button[data-scope="${scope}"]`);

describe("a menu before its code has loaded", () => {
  it("is a plain button that says it opens a menu", async () => {
    const { mount, ChipMenu } = await fresh();
    const container = await mount(<ChipMenu label="Today" items={items} />);
    const button = container.querySelector("button");
    expect(button?.getAttribute("aria-haspopup")).toBe("menu");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.getAttribute("data-scope")).toBeNull();
    expect(button?.textContent).toContain("Today");
  });

  it("opens the menu when it is tapped before the code arrived", async () => {
    const { act, mount, loadMenuParts, ChipMenu } = await fresh();
    const container = await mount(<ChipMenu label="Today" items={items} />);
    const plain = container.querySelector("button");
    expect(trigger(container, "menu")).toBeNull();

    await act(async () => {
      plain?.click();
      await loadMenuParts();
    });

    expect(trigger(container, "menu")).not.toBeNull();
    expect(trigger(container, "menu")).not.toBe(plain);
    expect(document.querySelector('[data-scope="menu"][data-part="content"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Alpha");
  });

  it("doesn't open on its own when nobody tapped it", async () => {
    const { act, mount, loadMenuParts, ChipMenu } = await fresh();
    const container = await mount(<ChipMenu label="Today" items={items} />);
    await act(async () => {
      await loadMenuParts();
    });
    expect(trigger(container, "menu")?.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent).not.toContain("Alpha");
  });
});

describe("an icon button with a tooltip", () => {
  it("is the plain button until the code is there, then is wrapped in its tooltip, keeping its label, its click and the focus", async () => {
    const { act, mount, loadMenuParts, IconButton } = await fresh();
    let clicks = 0;
    const container = await mount(<IconButton aria-label="Delete: Rent" tooltip onClick={() => (clicks += 1)}>x</IconButton>);
    const plain = container.querySelector("button");
    expect(plain?.getAttribute("aria-label")).toBe("Delete: Rent");
    expect(plain?.getAttribute("data-scope")).toBeNull();

    // Focus is a reason to fetch the code ahead of time, and the button that has it must not lose it to the swap.
    await act(async () => {
      plain?.focus();
      await loadMenuParts();
    });

    const wrapped = trigger(container, "tooltip") as HTMLButtonElement | null;
    expect(wrapped).not.toBeNull();
    expect(wrapped).not.toBe(plain);
    expect(wrapped?.getAttribute("aria-label")).toBe("Delete: Rent");
    expect(document.activeElement).toBe(wrapped);
    await act(async () => wrapped?.click());
    expect(clicks).toBe(1);
  });

  it("starts loading the code when the pointer reaches it", async () => {
    const { act, mount, IconButton } = await fresh();
    const container = await mount(<IconButton aria-label="Delete: Rent" tooltip>x</IconButton>);
    expect(trigger(container, "tooltip")).toBeNull();
    await act(async () => {
      container.querySelector("button")?.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      container.querySelector("button")?.dispatchEvent(new PointerEvent("pointerenter"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(trigger(container, "tooltip")).not.toBeNull();
  });
});
