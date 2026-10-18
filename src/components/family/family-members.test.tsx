import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ledgerSystem } from "@/components/ui/theme";
import type { FamilyData, FamilyMember } from "@/lib/family/repository";

import { FamilyMembers, joinedLabel } from "./family-members";

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
    ...overrides,
  };
}

const data: FamilyData = {
  family: { id: "f", name: "Popescu", createdAt: "2026-10-01T00:00:00Z" },
  members: [
    member({ memberId: "1", displayName: "Ana", isCreator: true }),
    member({ memberId: "2", displayName: "Dan" }),
    member({ memberId: "3", role: "kid", displayName: "Mara", username: "mara.p" }),
    member({ memberId: "4", role: "kid", displayName: "Teo", username: "teo" }),
  ],
};

function render(value: FamilyData) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <FamilyMembers data={value} />
    </ChakraProvider>,
  );
}

describe("joinedLabel", () => {
  it("formats the join date", () => {
    expect(joinedLabel("2026-10-12T08:00:00Z")).toBe("Joined Oct 12, 2026");
  });

  it("is empty for an unreadable date", () => {
    expect(joinedLabel("nope")).toBe("");
  });
});

describe("FamilyMembers", () => {
  it("groups members into parents and kids and shows names, usernames and the creator", () => {
    const html = render(data);
    expect(html).toContain("Popescu");
    expect(html.indexOf("Parents")).toBeLessThan(html.indexOf("Kids"));
    expect(html).toContain("Ana");
    expect(html).toContain("@mara.p");
    expect(html.match(/Creator/g)).toHaveLength(1);
  });

  it("leaves out a group with no members", () => {
    const html = render({ ...data, members: data.members.filter((m) => m.role === "parent") });
    expect(html).not.toContain("Kids");
  });

  it("shows a member's picture, named by them, and initials for a member without one", () => {
    const html = render({
      ...data,
      members: [
        member({ memberId: "1", displayName: "Ana Pop", avatarUrl: "/api/avatars/u1/a1b2" }),
        member({ memberId: "2", displayName: "Dan Ionescu" }),
      ],
    });
    expect(html).toMatch(/<img[^>]*src="\/api\/avatars\/u1\/a1b2"/);
    expect(html).toMatch(/<img[^>]*alt="Ana Pop"/);
    expect(html.match(/<img/g)).toHaveLength(1);
    expect(html).toContain(">DI<");
  });
});
