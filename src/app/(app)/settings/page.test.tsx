import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/settings",
}));

import SettingsPage from "./page";

function anAccount(email: string): AccountData {
  return { email, currency: "EUR", features: { family: true }, membership: null, mustChangePassword: false, avatarUrl: null };
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
    const html = render(anAccount("ana@kids.ifam.invalid"));

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
});
