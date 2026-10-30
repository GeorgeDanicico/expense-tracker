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
  return { email: "user@example.com", currency: "EUR", features: { family: true }, membership, mustChangePassword: false, avatarUrl: null };
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

const IMPORT_LINK = /<a[^>]*href="\/expenses\/import"[^>]*>.*?Import statement/s;

beforeEach(() => {
  state.search = "";
});

describe("the Import statement button on the Expenses page", () => {
  it("links to the import page for a user without a family", () => {
    expect(render(anAccount(null))).toMatch(IMPORT_LINK);
  });

  it("links to the import page for a kid with Expenses on", () => {
    const html = render(anAccount(kid(DEFAULT_KID_PERMISSIONS)));
    expect(html).toContain("Add expense");
    expect(html).toMatch(IMPORT_LINK);
  });

  it("is not shown to a kid with Expenses off, who gets the turned-off message instead of the page", () => {
    const html = render(anAccount(kid({ ...DEFAULT_KID_PERMISSIONS, expenses: "off" })));
    expect(html).toContain("This part of the app is turned off for you. Ask a parent.");
    expect(html).not.toContain("Import statement");
    expect(html).not.toContain("/expenses/import");
  });

  it("is not shown while the account is still loading", () => {
    expect(render(null)).not.toContain("Import statement");
  });

  it("is not shown on another member's data: an import only creates your own expenses", () => {
    state.search = `member=${"70000000-0000-4000-8000-000000000003"}`;
    const html = render(anAccount(null));
    expect(html).not.toContain("Import statement");
  });

  it("is not shown on the family view", () => {
    state.search = "member=all";
    expect(render(anAccount(null))).not.toContain("Import statement");
  });

  it("is not shown on a saved tab, only on the main ledger", () => {
    state.search = "tab=90000000-0000-4000-8000-000000000009";
    expect(render(anAccount(null))).not.toContain("Import statement");
  });
});
