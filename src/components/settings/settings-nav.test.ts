import { describe, expect, it } from "vitest";

import type { AccountMembership } from "@/lib/account/types";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

import { activeSettingsTab, settingsTabs } from "./settings-nav";

const membership = (role: "parent" | "kid"): AccountMembership => ({
  role,
  isCreator: false,
  familyName: "Popescu",
  permissions: DEFAULT_KID_PERMISSIONS,
});

describe("settingsTabs", () => {
  it("shows only Account while the family flag is off", () => {
    expect(settingsTabs({ features: { family: false }, membership: null }).map((tab) => tab.label)).toEqual(["Account"]);
  });

  it("shows the family tabs but not Manage family to a user without a family", () => {
    expect(settingsTabs({ features: { family: true }, membership: null }).map((tab) => tab.label)).toEqual([
      "Account",
      "Family",
      "My permissions",
    ]);
  });

  it("hides Manage family from a kid", () => {
    const labels = settingsTabs({ features: { family: true }, membership: membership("kid") }).map((tab) => tab.label);
    expect(labels).not.toContain("Manage family");
  });

  it("shows Manage family to a parent", () => {
    const labels = settingsTabs({ features: { family: true }, membership: membership("parent") }).map((tab) => tab.label);
    expect(labels).toEqual(["Account", "Family", "My permissions", "Manage family"]);
  });
});

describe("activeSettingsTab", () => {
  const tabs = settingsTabs({ features: { family: true }, membership: membership("parent") });

  it("picks the longest matching tab", () => {
    expect(activeSettingsTab(tabs, "/settings/family/manage")?.label).toBe("Manage family");
    expect(activeSettingsTab(tabs, "/settings/family")?.label).toBe("Family");
    expect(activeSettingsTab(tabs, "/settings")?.label).toBe("Account");
  });
});
