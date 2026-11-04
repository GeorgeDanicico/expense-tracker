import { describe, expect, it } from "vitest";

import type { AccountMembership } from "@/lib/account/types";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

import { activeSettingsRow, settingsGroups } from "./settings-nav";

const membership = (role: "parent" | "kid"): AccountMembership => ({
  memberId: "60000000-0000-4000-8000-000000000001",
  role,
  isCreator: false,
  familyName: "Popescu",
  permissions: DEFAULT_KID_PERMISSIONS,
});

const outline = (account: Parameters<typeof settingsGroups>[0]) =>
  settingsGroups(account).map((group) => `${group.label}: ${group.rows.map((row) => row.label).join(", ")}`);

describe("settingsGroups", () => {
  it("shows only Account, Notifications and the AI pages while the family flag is off", () => {
    expect(outline({ features: { family: false }, membership: null })).toEqual([
      "Account: Account, Notifications",
      "AI: AI assistants, AI features",
    ]);
  });

  it("shows the Family group but not Manage family to a user without a family or to a kid", () => {
    for (const who of [null, membership("kid")]) {
      expect(outline({ features: { family: true }, membership: who })).toEqual([
        "Account: Account, Notifications",
        "Family: Family, My permissions",
        "AI: AI assistants, AI features",
      ]);
    }
  });

  it("shows Manage family to a parent only", () => {
    expect(outline({ features: { family: true }, membership: membership("parent") })).toEqual([
      "Account: Account, Notifications",
      "Family: Family, My permissions, Manage family",
      "AI: AI assistants, AI features",
    ]);
  });

  it("keeps every settings page at its existing URL, for everyone who could reach it before", () => {
    const rows = settingsGroups({ features: { family: true }, membership: membership("parent") }).flatMap((group) => group.rows);
    expect(rows.map((row) => row.href)).toEqual([
      "/settings",
      "/settings/notifications",
      "/settings/family",
      "/settings/permissions",
      "/settings/family/manage",
      "/settings/mcp",
      "/settings/ai",
    ]);
  });
});

describe("activeSettingsRow", () => {
  const groups = settingsGroups({ features: { family: true }, membership: membership("parent") });

  it("picks the longest matching row", () => {
    expect(activeSettingsRow(groups, "/settings/family/manage")?.label).toBe("Manage family");
    expect(activeSettingsRow(groups, "/settings/family")?.label).toBe("Family");
    expect(activeSettingsRow(groups, "/settings")?.label).toBe("Account");
    expect(activeSettingsRow(groups, "/settings/permissions")?.label).toBe("My permissions");
    expect(activeSettingsRow(groups, "/settings/mcp")?.label).toBe("AI assistants");
    expect(activeSettingsRow(groups, "/settings/ai")?.label).toBe("AI features");
    expect(activeSettingsRow(groups, "/settings/notifications")?.label).toBe("Notifications");
  });

  it("finds nothing outside settings", () => {
    expect(activeSettingsRow(groups, "/more")).toBeUndefined();
  });
});
