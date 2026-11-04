import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));

import { ledgerSystem } from "@/components/ui/theme";

import type { FamilyMemberView } from "@/lib/family/views";

import { CreateFamilyForm } from "./create-family-form";
import { DeleteFamilyDialog } from "./delete-family-dialog";
import { DeleteKidAccountDialog } from "./delete-kid-account-dialog";
import { JoinFamilyForm, joinSummary } from "./join-family-form";

function render(node: React.ReactNode) {
  return renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{node}</ChakraProvider>);
}

describe("joinSummary", () => {
  it("names the inviter, the family and the role", () => {
    expect(joinSummary({ familyName: "Popescu", inviterName: "Ana", role: "kid" })).toBe(
      "Ana invited you to join Popescu as a kid.",
    );
  });

  it("falls back to a parent when the inviter is unknown", () => {
    expect(joinSummary({ familyName: "Popescu", inviterName: null, role: "parent" })).toBe(
      "A parent invited you to join Popescu as a parent.",
    );
  });
});

describe("the create and join forms", () => {
  it("asks for a family name", () => {
    const html = render(<CreateFamilyForm />);
    expect(html).toContain("Create a family");
    expect(html).toContain('name="name"');
  });

  it("asks for an invite code and fills in a given one", () => {
    const html = render(<JoinFamilyForm initialCode="ABCD2345" />);
    expect(html).toContain("Join with a code");
    expect(html).toContain('value="ABCD2345"');
  });
});

describe("typed confirmations stay for the destructive family actions", () => {
  const kid: FamilyMemberView = {
    memberId: "m-3", role: "kid", isCreator: false, displayName: "Mara", username: "mara.p", currency: "RON",
    color: null, avatarUrl: null, joinedAt: "2026-10-12T08:00:00Z", lastActiveAt: null,
  };

  it("deleting a family asks for its name and keeps the button off until it is typed", () => {
    const html = render(<DeleteFamilyDialog familyName="Popescu" open onOpenChange={() => {}} />);
    expect(html).toContain("Type Popescu to confirm");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Delete family/);
  });

  it("deleting a kid's account asks for the kid's name and a password, and keeps the button off", () => {
    const html = render(<DeleteKidAccountDialog member={kid} open onOpenChange={() => {}} />);
    expect(html).toContain("Mara");
    expect(html).toContain("currentPassword");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>).)*Delete account/);
  });
});
