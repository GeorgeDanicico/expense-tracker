import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings",
}));

import SettingsPage from "./page";

/** An account as `GET /api/account` answers it: a kid's generated address arrives as `email: null`. */
function anAccount(email: string | null, signInName = email ?? "ana", membership: AccountData["membership"] = null): AccountData {
  return { email, signInName, currency: "EUR", features: { family: true }, membership, mustChangePassword: false, avatarUrl: null };
}

function aMembership(overrides: Partial<NonNullable<AccountData["membership"]>> = {}): NonNullable<AccountData["membership"]> {
  return { memberId: "m1", role: "parent", isCreator: false, familyName: "The Smiths", permissions: PARENT_PERMISSIONS, ...overrides };
}

function render(account: AccountData) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={{ fallback: { [ACCOUNT_API_KEY]: account } }}>
        <SettingsPage />
      </SWRConfig>
    </ChakraProvider>,
  );
}

describe("Settings → Account", () => {
  it("asks a kid adding an email for their current password too", () => {
    const html = render(anAccount(null));

    expect(html).toContain("Add an email address");
    expect(html).toMatch(/<input[^>]*name="email"/);
    expect(html).toMatch(/<input(?=[^>]*name="currentPassword")(?=[^>]*type="password")(?=[^>]*autoComplete="current-password")(?=[^>]*required)[^>]*>/);
    expect(html).toContain("Current password");
  });

  it("shows no email form, and so no password field, to an account with a real email", () => {
    const html = render(anAccount("ana@example.com"));

    expect(html).not.toContain("Add an email address");
    expect(html).not.toMatch(/name="currentPassword"/);
  });

  it("offers Sign out everywhere behind a confirmation", () => {
    const html = render(anAccount("ana@example.com"));

    expect(html).toContain("Sign out everywhere");
    // The button is the ConfirmDialog's trigger: it opens the dialog, whose confirm button signs out.
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>(?:(?!<\/button>).)*Sign out everywhere<\/button>/);
  });

  it("offers Download my data", () => {
    const html = render(anAccount("ana@example.com"));

    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Download my data<\/button>/);
  });

  it("offers Delete my account behind a button that only opens a dialog", () => {
    const html = render(anAccount("ana@example.com"));

    expect(html).toContain("This can&#x27;t be undone.");
    // No password or phrase field until the dialog opens.
    expect(html).not.toMatch(/name="confirm"/);
    expect(html).toMatch(/<button(?![^>]*disabled)[^>]*>(?:(?!<\/button>).)*Delete my account<\/button>/);
  });

  it.each([
    ["the creator", aMembership({ isCreator: true }), "You created The Smiths, so your account can&#x27;t be deleted yet."],
    ["a second parent", aMembership(), "Ask the family&#x27;s creator to remove you"],
    ["a kid", aMembership({ role: "kid" }), "Ask a parent: they can delete your account from Manage family."],
  ])("tells %s why the account can't be deleted yet, and turns the button off", (_, membership, reason) => {
    const html = render(anAccount("ana@example.com", "ana", membership));

    expect(html).toContain(reason);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Delete my account<\/button>/);
  });
});
