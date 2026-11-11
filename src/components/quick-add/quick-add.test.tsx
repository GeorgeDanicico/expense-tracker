import { ChakraProvider } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";

import { navigationFor } from "@/components/layout/nav-items";
import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The sheet is loaded on demand in the app (PF9). `lazySheet` renders the loaded component at once, also on the server, so
// loading the module first gives the markup below the open sheet.
await (await import("./quick-add-provider")).preloadQuickAddSheet();

import { ExpensesClient } from "@/app/(app)/expenses/expenses-client";
import { RemindersClient } from "@/app/(app)/reminders/reminders-client";
import { HomeScreen } from "@/components/dashboard/home-screen";
import { AppShell } from "@/components/layout/app-shell";

import { initialKind, isQuickAddShortcut, quickAddKindsFor, type QuickAddKind } from "./kinds";

const parent: AccountData["membership"] = { memberId: "m1", role: "parent", isCreator: true, familyName: "Popescu", permissions: PARENT_PERMISSIONS };
const kid = (expenses: "edit" | "off"): AccountData["membership"] => ({
  memberId: "m2",
  role: "kid",
  isCreator: false,
  familyName: "Popescu",
  permissions: { ...DEFAULT_KID_PERMISSIONS, expenses },
});

const kindsOf = (membership: AccountData["membership"] | undefined) => quickAddKindsFor(navigationFor(membership).sections).map(({ kind }) => kind);

describe("what the sheet offers", () => {
  it("offers Expense, To-do, Reminder and Event in a family", () => {
    expect(kindsOf(parent)).toEqual(["expense", "todo", "reminder", "event"]);
  });

  it("offers no To-do or Event without a family", () => {
    expect(kindsOf(null)).toEqual(["expense", "reminder"]);
  });

  it("leaves Expense out for a kid without the expenses permission", () => {
    expect(kindsOf(kid("off"))).toEqual(["todo", "reminder", "event"]);
    expect(kindsOf(kid("edit"))).toEqual(["expense", "todo", "reminder", "event"]);
  });
});

describe("initialKind", () => {
  const offered: QuickAddKind[] = ["expense", "reminder"];

  it("opens on the kind asked for, else the last one used here, else Expense", () => {
    expect(initialKind(offered, "reminder", "expense")).toBe("reminder");
    expect(initialKind(offered, undefined, "reminder")).toBe("reminder");
    expect(initialKind(offered)).toBe("expense");
  });

  it("ignores a kind the user isn't offered", () => {
    expect(initialKind(offered, "event", "todo")).toBe("expense");
    expect(initialKind(["reminder"], "expense")).toBe("reminder");
  });
});

describe("the N shortcut", () => {
  const key = (overrides: Partial<Parameters<typeof isQuickAddShortcut>[0]> = {}) => ({
    key: "n", ctrlKey: false, metaKey: false, altKey: false, repeat: false, defaultPrevented: false, target: null, ...overrides,
  });
  const field = (selector: string) => ({ closest: (query: string) => (query.split(", ").some((part) => part === selector) ? {} : null) }) as unknown as EventTarget;

  it("opens the sheet on a plain N", () => {
    expect(isQuickAddShortcut(key(), false)).toBe(true);
    expect(isQuickAddShortcut(key({ key: "N" }), false)).toBe(true);
  });

  it("leaves N to a field being typed in", () => {
    expect(isQuickAddShortcut(key({ target: field("input") }), false)).toBe(false);
    expect(isQuickAddShortcut(key({ target: field("textarea") }), false)).toBe(false);
    expect(isQuickAddShortcut(key({ target: field("[contenteditable='true']") }), false)).toBe(false);
  });

  it("ignores Ctrl+N, Cmd+N, a held key, other keys and an open dialog", () => {
    expect(isQuickAddShortcut(key({ ctrlKey: true }), false)).toBe(false);
    expect(isQuickAddShortcut(key({ metaKey: true }), false)).toBe(false);
    expect(isQuickAddShortcut(key({ repeat: true }), false)).toBe(false);
    expect(isQuickAddShortcut(key({ key: "m" }), false)).toBe(false);
    expect(isQuickAddShortcut(key(), true)).toBe(false);
  });
});

function renderShell(screen: ReactNode, membership: AccountData["membership"] = parent) {
  const account: AccountData = { email: "a@b.c", signInName: "a@b.c", currency: "EUR", features: { family: true }, membership, mustChangePassword: false, avatarUrl: null };
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={{ provider: () => new Map(), fetcher: () => new Promise(() => {}), fallback: { [ACCOUNT_API_KEY]: account } }}>
        <AppShell signInName="a@b.c" quickAdd={{}}>{screen}</AppShell>
      </SWRConfig>
    </ChakraProvider>,
  );
}

/** The sheet's own markup: the dialog, from its title to the end of the page. */
const sheetOf = (html: string) => html.slice(html.indexOf('role="dialog"'));

describe("the quick-add sheet", () => {
  it.each([
    // Home's page is a server component that starts its data on the server (PF6); its screen is the same.
    ["Home", <HomeScreen key="home" />],
    ["Expenses", <ExpensesClient key="expenses" />],
    ["Reminders", <RemindersClient key="reminders" />],
  ])("is the same sheet from %s, opening on the fast expense form", (_screen, page) => {
    const html = renderShell(page);
    const sheet = sheetOf(html);
    expect(sheet).toContain(">Quick add<");
    expect(sheet).toContain('aria-label="What to add"');
    for (const label of ["Expense", "To-do", "Reminder", "Event"]) expect(sheet).toContain(`>${label}<`);
    const amount = sheet.match(/<input[^>]*name="amount"[^>]*>/)?.[0];
    expect(amount).toContain('inputMode="decimal"');
    expect(sheet).toContain("Save expense");
    // The + and Add both open it.
    expect(html).toContain('aria-label="Quick add"');
    expect(html).toMatch(/<button[^>]*>.*Add<\/button>/);
  });

  it("offers only Expense and Reminder to someone without a family", () => {
    const sheet = sheetOf(renderShell(<RemindersClient />, null));
    expect(sheet).toContain(">Reminder<");
    expect(sheet).not.toContain(">To-do<");
    expect(sheet).not.toContain(">Event<");
  });
});
