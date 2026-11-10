// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Provider } from "@/components/ui/provider";
import { SLOW_MESSAGE } from "@/components/ui/data-state";

import { ScreenPreview, type FixtureMode } from "./[screen]/screen-preview";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const closers: (() => void)[] = [];

async function mountPreview(screen: "todos" | "reminders" | "family", fixture: FixtureMode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<Provider><SWRConfig value={{ provider: () => new Map() }}><ScreenPreview screen={screen} fixture={fixture} /></SWRConfig></Provider>); });
  closers.push(() => { act(() => root.unmount()); container.remove(); });
  return container;
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const close of closers.splice(0)) close();
  vi.useRealTimers();
});

describe("the preview's two failing fixtures", () => {
  it.each(["todos", "reminders", "family"] as const)("a request that never answers shows %s's slow state, with a Retry", async (screen) => {
    const page = await mountPreview(screen, "hang");

    await advance(7_999);
    expect(page.textContent).not.toContain(SLOW_MESSAGE);
    await advance(1);

    const main = page.querySelector("main") ?? page;
    expect(main.textContent).toContain(SLOW_MESSAGE);
    expect([...main.querySelectorAll("button")].some((button) => button.textContent?.includes("Retry"))).toBe(true);
  });

  it.each(["todos", "reminders", "family"] as const)("a request that fails shows %s's error, with a way to try again", async (screen) => {
    const page = await mountPreview(screen, "fail");

    await advance(15_000);

    expect(page.textContent).toContain("Unable to load data");
    expect([...page.querySelectorAll("button")].some((button) => button.textContent?.includes("Try again"))).toBe(true);
  });
});
