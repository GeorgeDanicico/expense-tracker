import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData, AccountMembership } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

const state = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.search),
  usePathname: () => "/expenses",
}));

import ExpensesPage from "./page";

function anAccount(membership: AccountMembership | null): AccountData {
  return { email: "user@example.com", signInName: "user@example.com", currency: "EUR", features: { family: true }, membership, mustChangePassword: false, avatarUrl: null };
}

const kidId = "60000000-0000-4000-8000-000000000002";
const kid = (permissions: AccountMembership["permissions"]): AccountMembership =>
  ({ memberId: kidId, role: "kid", isCreator: false, familyName: "Popescu", permissions });

/** The real Expenses page with the account already in the cache; the ledger itself is still loading. */
function render(account: AccountData | null) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={{ fallback: account ? { [ACCOUNT_API_KEY]: account } : {} }}>
        <ExpensesPage />
      </SWRConfig>
    </ChakraProvider>,
  );
}

const MENU = 'aria-label="More expense actions"';

beforeEach(() => {
  state.search = "";
});

// Import and export are behind ⋯ (their items: `expensesMenuItems`); adding is the bottom bar's +.
describe("the Expenses page", () => {
  it("has no Add expense button of its own, and its ⋯ for a user without a family", () => {
    const html = render(anAccount(null));
    expect(html).not.toContain("Add expense");
    expect(html).toContain(MENU);
  });

  it("has its ⋯ for a kid with Expenses on", () => {
    expect(render(anAccount(kid(DEFAULT_KID_PERMISSIONS)))).toContain(MENU);
  });

  it("is not shown to a kid with Expenses off, who gets the turned-off message instead of the page", () => {
    const html = render(anAccount(kid({ ...DEFAULT_KID_PERMISSIONS, expenses: "off" })));
    expect(html).toContain("This part of the app is turned off for you. Ask a parent.");
    expect(html).not.toContain(MENU);
  });

  it("shows nothing while the account is still loading", () => {
    expect(render(null)).not.toContain(MENU);
  });

  it("keeps ⋯ (for export) on another member's month", () => {
    state.search = `member=${"70000000-0000-4000-8000-000000000003"}`;
    expect(render(anAccount(null))).toContain(MENU);
  });

  it("has no ⋯ on the family view, which can't be exported or imported into", () => {
    state.search = "member=all";
    expect(render(anAccount(null))).not.toContain(MENU);
  });

  it("shows the month as a compact control and the tabs as chips", () => {
    const html = render(anAccount(null));
    expect(html).toMatch(/aria-label="Month: [A-Z][a-z]+ \d{4}"/);
    expect(html).toContain('aria-label="Previous month"');
    expect(html).toMatch(/role="group"[^>]*aria-label="Expense tabs"/);
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>All<\/button>/);
    expect(html).toContain("Filters");
  });
});
