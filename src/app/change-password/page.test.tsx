import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData } from "@/lib/account/types";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/change-password",
}));

import ChangePasswordPage from "./page";

function render(mustChangePassword: boolean) {
  const account: AccountData = {
    email: "ana@kids.ifam.invalid",
    signInName: "ana@kids.ifam.invalid",
    currency: "EUR",
    features: { family: true },
    membership: null,
    mustChangePassword,
    avatarUrl: null,
  };
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={{ fallback: { [ACCOUNT_API_KEY]: account } }}>
        <ChangePasswordPage />
      </SWRConfig>
    </ChakraProvider>,
  );
}

const CURRENT_PASSWORD_INPUT = /<input(?=[^>]*name="currentPassword")(?=[^>]*type="password")(?=[^>]*autoComplete="current-password")(?=[^>]*required)[^>]*>/;

describe("the change-password page", () => {
  it("asks a kid who must change their password for the temporary one, then the new one twice", () => {
    const html = render(true);

    expect(html).toContain("Temporary password");
    expect(html).toContain("The password you were given and just signed in with.");
    expect(html).toMatch(CURRENT_PASSWORD_INPUT);
    expect(html).toMatch(/<input(?=[^>]*name="password")(?=[^>]*autoComplete="new-password")[^>]*>/);
    expect(html).toMatch(/<input[^>]*name="confirmPassword"/);
    // The current password comes first.
    expect(html.indexOf('name="currentPassword"')).toBeLessThan(html.indexOf('name="password"'));
  });

  it("lets a kid who doesn't know the temporary password sign out", () => {
    const html = render(true);

    expect(html).toContain("Don&#x27;t know the temporary password?");
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Sign out<\/button>/);
  });

  it("calls it the current password for any other account, with no sign-out row", () => {
    const html = render(false);

    expect(html).toContain("Current password");
    expect(html).not.toContain("Temporary password");
    expect(html).toMatch(CURRENT_PASSWORD_INPUT);
    expect(html).not.toContain("Don&#x27;t know the temporary password?");
  });
});
