import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { FamilyData, FamilyMember } from "@/lib/family/repository";
import { DEFAULT_KID_PERMISSIONS, PERMISSION_PRESETS } from "@/lib/permissions";

import { matchingPreset, PermissionsEditor } from "./permissions-editor";
import { ManageMembers } from "./manage-members";

function member(overrides: Partial<FamilyMember>): FamilyMember {
  return {
    memberId: "m",
    userId: "u",
    role: "parent",
    isCreator: false,
    displayName: null,
    username: null,
    currency: "RON",
    joinedAt: "2026-10-12T08:00:00Z",
    lastActiveAt: null,
    ...overrides,
  };
}

const data: FamilyData = {
  family: { id: "f", name: "Popescu", createdAt: "2026-10-01T00:00:00Z" },
  members: [
    member({ memberId: "1", displayName: "Ana", isCreator: true }),
    member({ memberId: "3", role: "kid", displayName: "Mara", username: "mara.p", permissions: DEFAULT_KID_PERMISSIONS }),
  ],
};

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

describe("ManageMembers", () => {
  it("lists every member with role, creator badge and last active", () => {
    const html = render(<ManageMembers data={data} />);
    expect(html).toContain("Ana");
    expect(html).toContain("Creator");
    expect(html).toContain(">Parent<");
    expect(html).toContain(">Kid<");
    expect(html).toContain("Never");
  });

  it("offers Edit permissions for kids only", () => {
    const html = render(<ManageMembers data={data} />);
    expect(html.match(/Edit permissions/g)).toHaveLength(2); // aria-label and text of the single kid button
    expect(html).toContain("Edit permissions for Mara");
    expect(html).not.toContain("Edit permissions for Ana");
  });
});

describe("PermissionsEditor", () => {
  it("shows a control for every module with only its allowed levels", () => {
    const html = render(<PermissionsEditor value={DEFAULT_KID_PERMISSIONS} onChange={() => {}} />);
    expect(html).toContain("Family finance access");
    expect(html).toContain("Can see");
    expect(html).not.toContain(">View<");
  });

  it("finds the preset that matches, or none for a custom mix", () => {
    expect(matchingPreset(PERMISSION_PRESETS.teen)).toBe("teen");
    expect(matchingPreset({ ...PERMISSION_PRESETS.teen, net_worth: "off" })).toBeNull();
  });
});
