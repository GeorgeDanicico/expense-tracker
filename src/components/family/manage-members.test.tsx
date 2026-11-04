import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { FamilyMemberView, FamilyView } from "@/lib/family/views";
import { DEFAULT_KID_PERMISSIONS, PERMISSION_PRESETS } from "@/lib/permissions";

import { KidSignInDetails } from "./kid-sign-in-details";
import { matchingPreset, PermissionsEditor } from "./permissions-editor";
import { ManageMembers } from "./manage-members";

function member(overrides: Partial<FamilyMemberView>): FamilyMemberView {
  return {
    memberId: "m",
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

const data: FamilyView = {
  family: { name: "Popescu" },
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
    expect(html).toContain("Parent · ");
    expect(html).toContain("Kid · @mara.p");
    expect(html).toContain("Never");
  });

  it("offers Permissions for kids only", () => {
    const html = render(<ManageMembers data={data} />);
    expect(html).toContain("Permissions: Mara");
    expect(html).not.toContain("Permissions: Ana");
  });
});

describe("ManageMembers colours", () => {
  it("offers a colour button for every member", () => {
    const html = render(<ManageMembers data={data} />);
    expect(html).toContain("Colour: Ana");
    expect(html).toContain("Colour: Mara");
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
    expect(html).toContain("Reset password: Mara");
    expect(html).not.toContain("Reset password: Ana");
  });

  it("offers Delete account for kids only", () => {
    const html = render(<ManageMembers data={data} />);
    expect(html).toContain("Delete account: Mara");
    expect(html).not.toContain("Delete account: Ana");
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
  const withParent: FamilyView = {
    ...data,
    members: [...data.members, member({ memberId: "2", displayName: "Dan" })],
  };

  it("offers Remove to the creator for everyone but the creator", () => {
    const html = render(<ManageMembers data={withParent} isCreator />);
    expect(html).toContain("Remove from family: Mara");
    expect(html).toContain("Remove from family: Dan");
    expect(html).not.toContain("Remove from family: Ana");
  });

  it("hides Remove from other parents", () => {
    const html = render(<ManageMembers data={withParent} />);
    expect(html).not.toContain("from the family");
  });
});
