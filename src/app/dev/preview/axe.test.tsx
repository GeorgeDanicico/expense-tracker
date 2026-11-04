// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScreenPreview } from "./[screen]/screen-preview";
import { describeViolations, mountForAxe, runAxe } from "@/test/axe";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

const MAIN = ["dashboard", "expenses", "insights", "investments", "net-worth", "reminders", "todos", "calendar", "more", "settings", "family", "manage-family"] as const;

describe("axe on the main screens' preview renders", () => {
  let unmount: (() => Promise<void>) | undefined;
  const errors = vi.spyOn(console, "error");
  afterEach(async () => { await unmount?.(); unmount = undefined; errors.mockClear(); });

  it.each(MAIN)("%s has no violations", async (screen) => {
    const mounted = await mountForAxe(<ScreenPreview screen={screen} />);
    unmount = mounted.unmount;
    // The fixtures have loaded: more than the shell, and no loading placeholders left.
    expect(mounted.container.querySelector("main")?.textContent?.length ?? 0).toBeGreaterThan(40);
    const violations = await runAxe(mounted.container);
    expect(describeViolations(violations)).toBe("");
    // Invalid nesting (a div in a p) is something screen readers trip on, and React says so.
    expect(errors.mock.calls.map((call) => String(call[0])).filter((line) => /cannot (contain|be a descendant)|validateDOMNesting/.test(line))).toEqual([]);
  }, 30_000);
});

describe("axe on the quick-add sheet", () => {
  it.each(["expense", "todo", "reminder", "event"] as const)("the %s sheet has no violations", async (kind) => {
    const mounted = await mountForAxe(<ScreenPreview screen="dashboard" quickAdd={{ kind }} />);
    // The sheet is a dialog in a portal, outside the page's container. The page behind it is
    // aria-hidden while the dialog traps focus (the usual modal pattern, which axe's
    // aria-hidden-focus cannot see is trapped), so the dialog alone is checked.
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog).not.toBeNull();
    const violations = await runAxe(dialog!);
    await mounted.unmount();
    expect(describeViolations(violations)).toBe("");
  }, 30_000);
});

describe("the axe helper", () => {
  it("does find a violation (an icon button without a name)", async () => {
    const mounted = await mountForAxe(<main><button type="button"><svg aria-hidden="true" /></button></main>);
    const violations = await runAxe(mounted.container);
    await mounted.unmount();
    expect(violations.map((v) => v.id)).toContain("button-name");
  });
});
