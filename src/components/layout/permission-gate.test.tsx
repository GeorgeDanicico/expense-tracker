import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { AccountData, AccountMembership } from "@/lib/account/types";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

const state = vi.hoisted(() => ({ account: undefined as AccountData | undefined, error: undefined as unknown }));

vi.mock("@/hooks/use-account", () => ({
  useAccount: () => ({ account: state.account, error: state.error, isLoading: !state.account && !state.error, mutate: vi.fn() }),
}));

import { PermissionGate } from "./permission-gate";

function render() {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <PermissionGate module="investments">
        <p>secret page</p>
      </PermissionGate>
    </ChakraProvider>,
  );
}

function anAccount(membership: AccountMembership | null): AccountData {
  return { email: "user@example.com", currency: "EUR", features: { family: true }, membership, mustChangePassword: false, avatarUrl: null };
}

const kid = { role: "kid" as const };

beforeEach(() => {
  state.account = undefined;
  state.error = undefined;
});

describe("PermissionGate", () => {
  it("shows the page to a user without a family", () => {
    state.account = anAccount(null);
    expect(render()).toContain("secret page");
  });

  it("shows the message instead of the page to a kid with the module off", () => {
    state.account = anAccount({ ...kid, memberId: "60000000-0000-4000-8000-000000000002", isCreator: false, familyName: "Popescu", permissions: DEFAULT_KID_PERMISSIONS });
    const html = render();
    expect(html).toContain("This part of the app is turned off for you. Ask a parent.");
    expect(html).not.toContain("secret page");
  });

  it("shows the page to a kid with the module on", () => {
    state.account = anAccount({ memberId: "60000000-0000-4000-8000-000000000002", role: "kid", isCreator: false, familyName: "Popescu", permissions: { ...DEFAULT_KID_PERMISSIONS, investments: "edit" } });
    expect(render()).toContain("secret page");
  });

  it("shows neither the page nor the message while the account loads", () => {
    const html = render();
    expect(html).not.toContain("secret page");
    expect(html).not.toContain("turned off");
  });

  it("shows an error, not the message, when the account fails to load", () => {
    state.error = new Error("boom");
    const html = render();
    expect(html).not.toContain("turned off");
  });
});
