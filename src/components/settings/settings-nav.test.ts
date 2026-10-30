import { describe, expect, it } from "vitest";

import type { AccountMembership } from "@/lib/account/types";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

import { activeSettingsTab, settingsTabs } from "./settings-nav";

const membership = (role: "parent" | "kid"): AccountMembership => ({
  memberId: "60000000-0000-4000-8000-000000000001",
  role,
  isCreator: false,
  familyName: "Popescu",
  permissions: DEFAULT_KID_PERMISSIONS,
});

describe("settingsTabs", () => {
  it("shows only Account, AI assistants and Notifications while the family flag is off", () => {
    expect(settingsTabs({ features: { family: false }, membership: null }).map((tab) => tab.label)).toEqual([
      "Account",
      "AI assistants",
      "AI features",
      "Notifications",
    ]);
  });

  it("shows AI assistants to everyone, at /settings/mcp", () => {
    for (const account of [
      { features: { family: false }, membership: null },
      { features: { family: true }, membership: null },
      { features: { family: true }, membership: membership("kid") },
      { features: { family: true }, membership: membership("parent") },
    ]) {
      expect(settingsTabs(account)).toContainEqual({ href: "/settings/mcp", label: "AI assistants" });
    }
  });

  it("shows AI features to everyone, at /settings/ai", () => {
    for (const account of [
      { features: { family: false }, membership: null },
      { features: { family: true }, membership: membership("kid") },
      { features: { family: true }, membership: membership("parent") },
    ]) {
      expect(settingsTabs(account)).toContainEqual({ href: "/settings/ai", label: "AI features" });
    }
  });

  it("shows Notifications to everyone, right after AI assistants, at /settings/notifications", () => {
    for (const account of [
      { features: { family: false }, membership: null },
      { features: { family: true }, membership: null },
      { features: { family: true }, membership: membership("kid") },
      { features: { family: true }, membership: membership("parent") },
    ]) {
      const tabs = settingsTabs(account);
      expect(tabs.at(-1)).toEqual({ href: "/settings/notifications", label: "Notifications" });
      expect(tabs.at(-2)?.label).toBe("AI features");
      expect(tabs.at(-3)?.label).toBe("AI assistants");
    }
  });

  it("shows the family tabs but not Manage family to a user without a family", () => {
    expect(settingsTabs({ features: { family: true }, membership: null }).map((tab) => tab.label)).toEqual([
      "Account",
      "Family",
      "My permissions",
      "AI assistants",
      "AI features",
      "Notifications",
    ]);
  });

  it("hides Manage family from a kid", () => {
    const labels = settingsTabs({ features: { family: true }, membership: membership("kid") }).map((tab) => tab.label);
    expect(labels).not.toContain("Manage family");
  });

  it("shows Manage family to a parent", () => {
    const labels = settingsTabs({ features: { family: true }, membership: membership("parent") }).map((tab) => tab.label);
    expect(labels).toEqual(["Account", "Family", "My permissions", "Manage family", "AI assistants", "AI features", "Notifications"]);
  });
});

describe("activeSettingsTab", () => {
  const tabs = settingsTabs({ features: { family: true }, membership: membership("parent") });

  it("picks the longest matching tab", () => {
    expect(activeSettingsTab(tabs, "/settings/family/manage")?.label).toBe("Manage family");
    expect(activeSettingsTab(tabs, "/settings/family")?.label).toBe("Family");
    expect(activeSettingsTab(tabs, "/settings")?.label).toBe("Account");
    expect(activeSettingsTab(tabs, "/settings/mcp")?.label).toBe("AI assistants");
    expect(activeSettingsTab(tabs, "/settings/ai")?.label).toBe("AI features");
    expect(activeSettingsTab(tabs, "/settings/notifications")?.label).toBe("Notifications");
  });
});
