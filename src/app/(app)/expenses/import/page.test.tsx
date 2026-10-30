import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData, AccountMembership } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/expenses/import",
}));
const screen = vi.hoisted(() => vi.fn(() => <p>the import screen</p>));
vi.mock("@/components/expenses/import/import-screen", () => ({ ImportScreen: screen }));

import ImportPage from "./page";

function anAccount(membership: AccountMembership | null): AccountData {
  return { email: "user@example.com", currency: "EUR", features: { family: true }, membership, mustChangePassword: false, avatarUrl: null };
}

const kid = (permissions: AccountMembership["permissions"]): AccountMembership =>
  ({ memberId: "60000000-0000-4000-8000-000000000002", role: "kid", isCreator: false, familyName: "Popescu", permissions });

function render(account: AccountData) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={{ fallback: { [ACCOUNT_API_KEY]: account } }}>
        <ImportPage />
      </SWRConfig>
    </ChakraProvider>,
  );
}

describe("the import page's permission gate", () => {
  it("shows the import screen to a user with Expenses", () => {
    expect(render(anAccount(null))).toContain("the import screen");
    expect(render(anAccount(kid(DEFAULT_KID_PERMISSIONS)))).toContain("the import screen");
  });

  it("shows a kid with Expenses off the turned-off message and never mounts the import screen", () => {
    screen.mockClear();
    const html = render(anAccount(kid({ ...DEFAULT_KID_PERMISSIONS, expenses: "off" })));
    expect(html).toContain("This part of the app is turned off for you. Ask a parent.");
    expect(html).not.toContain("the import screen");
    expect(screen).not.toHaveBeenCalled();
  });
});
