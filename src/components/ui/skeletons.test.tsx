// @vitest-environment happy-dom
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { Component, act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomeSkeleton } from "@/components/dashboard/home-skeleton";
import { SectionError } from "@/components/ui/section-error";
import {
  CalendarSkeleton,
  ExpensesSkeleton,
  InsightsSkeleton,
  LedgerSkeleton,
  PanelSkeleton,
  RemindersSkeleton,
  RowsCardSkeleton,
  TodosSkeleton,
} from "@/components/ui/skeletons";
import { SLOW_MESSAGE } from "@/components/ui/slow-notice";
import { Provider } from "@/components/ui/provider";
import { markSlow, clearSlow } from "@/lib/api/slow-keys";

const reportClientError = vi.hoisted(() => vi.fn());
vi.mock("@/lib/client-log", () => ({ reportClientError }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mounted = new Set<() => void>();

async function mount(element: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Provider><SWRConfig value={{ provider: () => new Map() }}>{element}</SWRConfig></Provider>);
  });
  mounted.add(() => { act(() => root.unmount()); container.remove(); });
  return container;
}

// The skeletons read the account (To-dos' heading names the family); nothing here answers.
beforeEach(() => { vi.stubGlobal("fetch", () => new Promise(() => undefined)); });
afterEach(() => {
  for (const close of mounted) close();
  mounted.clear();
  vi.unstubAllGlobals();
  reportClientError.mockReset();
});

const SKELETONS: [string, string, ReactNode][] = [
  ["Home", "Loading your day…", <HomeSkeleton key="home" />],
  ["Expenses", "Loading expenses…", <ExpensesSkeleton key="expenses" />],
  ["the ledger", "Loading expenses…", <LedgerSkeleton key="ledger" />],
  ["a list in a card", "Loading saved tabs…", <RowsCardSkeleton key="rows" label="Loading saved tabs…" />],
  ["To-dos", "Loading the board…", <TodosSkeleton key="todos" />],
  ["Reminders", "Loading your reminders…", <RemindersSkeleton key="reminders" />],
  ["a panel", "Loading your net worth…", <PanelSkeleton key="panel" title="Net worth" label="Loading your net worth…" />],
  ["Calendar", "Loading the calendar…", <CalendarSkeleton key="calendar" />],
  ["Insights", "Loading insights…", <InsightsSkeleton key="insights" />],
];

describe("skeletons", () => {
  it.each(SKELETONS)("%s is busy and announces its label", async (_name, label, element) => {
    const page = await mount(element);
    const busy = page.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy?.getAttribute("role")).toBe("status");
    expect(busy?.querySelector(".sr-only")?.textContent).toBe(label);
  });

  it("keeps a real heading where it knows one, and hides the grey shapes from a screen reader", async () => {
    const page = await mount(<RemindersSkeleton />);
    expect(page.querySelector("h1")?.textContent).toBe("Reminders");
    expect(page.querySelector('[aria-hidden="true"] h1')).toBeNull();
    expect(page.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

  it("says it is taking longer than usual for its own slowKey, and for no other", async () => {
    const page = await mount(<TodosSkeleton slowKey="/api/todos" />);
    await act(async () => markSlow("/api/other"));
    expect(page.textContent).not.toContain(SLOW_MESSAGE);
    await act(async () => markSlow("/api/todos"));
    expect(page.textContent).toContain(SLOW_MESSAGE);
    expect([...page.querySelectorAll("button")].some((button) => button.textContent?.includes("Retry"))).toBe(true);
    await act(async () => { clearSlow("/api/todos"); clearSlow("/api/other"); });
    expect(page.textContent).not.toContain(SLOW_MESSAGE);
  });
});

describe("a section's error boundary", () => {
  /** Next's error boundary in miniature: it catches what its children throw and shows `fallback` in their place. */
  class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
    state = { error: null as unknown };
    static getDerivedStateFromError(error: unknown) { return { error }; }
    render() {
      return this.state.error === null
        ? this.props.children
        : <SectionError error={this.state.error} retry={() => this.setState({ error: null })} />;
    }
  }

  it("keeps the shell, reports the error once, and tries again", async () => {
    let broken = true;
    function Page() {
      if (broken) throw new Error("this section broke");
      return <p>the section, working</p>;
    }
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = await mount(
      <div>
        <nav aria-label="shell">the shell</nav>
        <Boundary><Page /></Boundary>
      </div>,
    );
    consoleError.mockRestore();

    expect(app.querySelector("nav")?.textContent).toBe("the shell");
    expect(app.textContent).toContain("We couldn’t load this page");
    expect(reportClientError).toHaveBeenCalledTimes(1);
    expect(reportClientError).toHaveBeenCalledWith(expect.objectContaining({ message: "this section broke" }), "boundary");
    expect(app.querySelector('a[href="/dashboard"]')?.textContent).toBe("Go to Home");

    broken = false;
    const retry = [...app.querySelectorAll("button")].find((button) => button.textContent?.includes("Try again"));
    await act(async () => { retry!.click(); });
    expect(app.textContent).toContain("the section, working");
    expect(app.querySelector("nav")?.textContent).toBe("the shell");
  });
});

describe("the sections", () => {
  const appDir = join(process.cwd(), "src/app/(app)");
  const sections = readdirSync(appDir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  it("lists the ten sections the plan names", () => {
    expect(sections.sort()).toEqual(["calendar", "dashboard", "expenses", "insights", "investments", "more", "net-worth", "reminders", "settings", "todos"]);
  });

  it.each(sections)("%s has its own loading.tsx and error.tsx", (section) => {
    expect(existsSync(join(appDir, section, "loading.tsx"))).toBe(true);
    expect(existsSync(join(appDir, section, "error.tsx"))).toBe(true);
  });
});
