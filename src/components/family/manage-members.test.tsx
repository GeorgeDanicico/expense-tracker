import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { FamilyData, FamilyMember } from "@/lib/family/repository";
import { DEFAULT_KID_PERMISSIONS, PERMISSION_PRESETS } from "@/lib/permissions";

import { KidSignInDetails } from "./kid-sign-in-details";
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
    color: null,
    avatarUrl: null,
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

describe("ManageMembers colours", () => {
  it("offers a colour button for every member", () => {
    const html = render(<ManageMembers data={data} />);
    expect(html).toContain("Choose colour for Ana");
    expect(html).toContain("Choose colour for Mara");
  });
});

describe("PermissionsEditor", () => {
  it("shows a control for every module with only its allowed levels", () => {
    const html = render(<PermissionsEditor value={DEFAULT_KID_PERMISSIONS} onChange={() => {}} />);
    expect(html).toContain("Family finance access");
    expect(html).toContain("Can see");
    expect(html).not.toContain(">View<");
  });

  it("shows the AI features permission right after AI assistants", () => {
    const html = render(<PermissionsEditor value={DEFAULT_KID_PERMISSIONS} onChange={() => {}} />);
    expect(html).toContain("AI assistants access");
    expect(html).toContain("AI features access");
    expect(html.indexOf("AI features access")).toBeGreaterThan(html.indexOf("AI assistants access"));
  });

  it("finds the preset that matches, or none for a custom mix", () => {
    expect(matchingPreset(PERMISSION_PRESETS.teen)).toBe("teen");
    expect(matchingPreset({ ...PERMISSION_PRESETS.teen, net_worth: "off" })).toBeNull();
  });
});

describe("ManageMembers kid accounts", () => {
  it("offers Add a kid and Reset password for kids only", () => {
    const html = render(<ManageMembers data={data} />);
    expect(html).toContain("Add a kid");
    expect(html).toContain("Reset password for Mara");
    expect(html).not.toContain("Reset password for Ana");
  });
});

describe("KidSignInDetails", () => {
  it("tells the kid the username and password and warns it is shown once", () => {
    const html = render(<KidSignInDetails name="Ana" username="ana" password="tmp-pass-1" />);
    expect(html).toContain("Ana can sign in with the username <strong>ana</strong> and this password.");
    expect(html).toContain("choose a new one the first time");
    expect(html).toContain("tmp-pass-1");
    expect(html).toContain("Copy temporary password");
    expect(html).toContain("shown only once");
  });

  it("leaves out the username after a reset", () => {
    const html = render(<KidSignInDetails name="Ana" password="tmp-pass-1" />);
    expect(html).toContain("Ana can sign in with this password.");
    expect(html).not.toContain("username");
  });
});

describe("ManageMembers removal", () => {
  const withParent: FamilyData = {
    ...data,
    members: [...data.members, member({ memberId: "2", displayName: "Dan" })],
  };

  it("offers Remove to the creator for everyone but the creator", () => {
    const html = render(<ManageMembers data={withParent} isCreator />);
    expect(html).toContain("Remove Mara from the family");
    expect(html).toContain("Remove Dan from the family");
    expect(html).not.toContain("Remove Ana from the family");
  });

  it("hides Remove from other parents", () => {
    const html = render(<ManageMembers data={withParent} />);
    expect(html).not.toContain("from the family");
  });
});
