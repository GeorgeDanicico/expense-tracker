import { ChakraProvider } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";

import { NavItem } from "@/components/layout/nav-item";
import { NAV_ITEMS } from "@/components/layout/nav-items";
import { badgeText, onServiceWorkerNotification } from "@/components/reminders/use-reminder-badge";
import { ledgerSystem } from "@/components/ui/theme";
import { REMINDERS_SUMMARY_API_KEY, type RemindersSummaryResponse } from "@/lib/api/keys";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

function render(node: ReactNode, summary?: RemindersSummaryResponse) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={{ provider: () => new Map(), fetcher: () => new Promise(() => {}), fallback: summary ? { [REMINDERS_SUMMARY_API_KEY]: summary } : {} }}>
        {node}
      </SWRConfig>
    </ChakraProvider>,
  );
}

/** The link's text as assistive technology reads it: everything but the aria-hidden parts. */
function accessibleName(html: string) {
  const link = html.match(/<a\b[\s\S]*?<\/a>/)?.[0] ?? "";
  return link
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
    .replace(/<(\w+)[^>]*aria-hidden="true"[^>]*>.*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

const badge = (html: string) => html.match(/data-nav-badge=""[^>]*>([^<]*)</)?.[1] ?? null;

describe("badgeText", () => {
  it("hides at 0, counts up to 9, then says 9+", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-1)).toBeNull();
    expect(badgeText(1)).toBe("1");
    expect(badgeText(9)).toBe("9");
    expect(badgeText(10)).toBe("9+");
    expect(badgeText(42)).toBe("9+");
  });
});

describe("the Reminders nav badge", () => {
  it("shows due + overdue, with the count in the link's accessible name", () => {
    const html = render(<NavItem item={NAV_ITEMS.reminders} compact />, { due: 2, overdue: 1 });
    expect(badge(html)).toBe("3");
    expect(accessibleName(html)).toBe("Reminders, 3 due");
  });

  it("is hidden at 0 and while the summary loads", () => {
    for (const summary of [{ due: 0, overdue: 0 }, undefined]) {
      const html = render(<NavItem item={NAV_ITEMS.reminders} />, summary);
      expect(badge(html)).toBeNull();
      expect(accessibleName(html)).toBe("Reminders");
    }
  });

  it("says 9+ above 9 but reads out the real count", () => {
    const html = render(<NavItem item={NAV_ITEMS.reminders} />, { due: 4, overdue: 8 });
    expect(badge(html)).toBe("9+");
    expect(accessibleName(html)).toBe("Reminders, 12 due");
  });

  it("is red while anything is overdue, the brand colour while things are only due", () => {
    const overdue = render(<NavItem item={NAV_ITEMS.reminders} />, { due: 0, overdue: 1 });
    const due = render(<NavItem item={NAV_ITEMS.reminders} />, { due: 1, overdue: 0 });
    expect(overdue).not.toEqual(due);
    expect(badge(overdue)).toBe("1");
    expect(badge(due)).toBe("1");
  });

  it("leaves rows without a badge alone", () => {
    const html = render(<NavItem item={NAV_ITEMS.todos} />, { due: 5, overdue: 0 });
    expect(badge(html)).toBeNull();
    expect(accessibleName(html)).toBe("To-dos");
  });
});

describe("onServiceWorkerNotification", () => {
  it("refreshes on the service worker's notification message only", () => {
    const container = new EventTarget();
    const refresh = vi.fn();
    const stop = onServiceWorkerNotification(container, refresh);

    container.dispatchEvent(new MessageEvent("message", { data: { type: "notification" } }));
    expect(refresh).toHaveBeenCalledTimes(1);

    container.dispatchEvent(new MessageEvent("message", { data: { type: "something-else" } }));
    container.dispatchEvent(new MessageEvent("message", { data: "notification" }));
    container.dispatchEvent(new MessageEvent("message", { data: null }));
    expect(refresh).toHaveBeenCalledTimes(1);

    stop();
    container.dispatchEvent(new MessageEvent("message", { data: { type: "notification" } }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a service worker", () => {
    expect(() => onServiceWorkerNotification(undefined, vi.fn())()).not.toThrow();
  });
});
