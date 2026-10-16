import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountData, AccountMembership } from "@/lib/account/types";
import { PARENT_PERMISSIONS } from "@/lib/family/repository";
import type { ModuleKey, PermissionLevel } from "@/lib/permissions";

const accountState = vi.hoisted(() => ({ account: undefined as AccountData | undefined }));

vi.mock("@/hooks/use-account", () => ({
  useAccount: () => ({ account: accountState.account }),
}));

import { useCan } from "@/hooks/use-can";

function Probe({ module, level }: { module: ModuleKey; level: PermissionLevel }) {
  return String(useCan(module, level));
}

/** Renders a component that calls `useCan` and returns what it answered. */
function renderUseCan(module: ModuleKey, level: PermissionLevel) {
  return renderToStaticMarkup(createElement(Probe, { module, level })) === "true";
}

function anAccount(membership: AccountMembership | null): AccountData {
  return { email: "user@example.com", currency: "EUR", features: { family: true }, membership, mustChangePassword: false };
}

beforeEach(() => {
  accountState.account = undefined;
});

describe("useCan", () => {
  it("answers false while the account is loading", () => {
    expect(renderUseCan("expenses", "edit")).toBe(false);
    expect(renderUseCan("family_finance", "view")).toBe(false);
  });

  it("answers true for every module when the user has no family", () => {
    accountState.account = anAccount(null);

    expect(renderUseCan("investments", "edit")).toBe(true);
    expect(renderUseCan("family_finance", "view")).toBe(true);
  });

  it("answers true for every module for a parent", () => {
    accountState.account = anAccount({
      role: "parent",
      isCreator: true,
      familyName: "The Smiths",
      permissions: PARENT_PERMISSIONS,
    });

    expect(renderUseCan("net_worth", "edit")).toBe(true);
    expect(renderUseCan("family_finance", "view")).toBe(true);
  });

  it("follows a kid's permissions", () => {
    accountState.account = anAccount({
      role: "kid",
      isCreator: false,
      familyName: "The Smiths",
      permissions: { expenses: "edit", investments: "off", net_worth: "off", family_finance: "off" },
    });

    expect(renderUseCan("expenses", "edit")).toBe(true);
    expect(renderUseCan("expenses", "view")).toBe(true);
    expect(renderUseCan("investments", "edit")).toBe(false);
    expect(renderUseCan("family_finance", "view")).toBe(false);
  });
});
