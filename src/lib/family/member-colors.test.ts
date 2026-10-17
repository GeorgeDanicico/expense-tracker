import { describe, expect, it } from "vitest";

import { memberColorTokens, OTHER_MEMBER_COLOR } from "@/lib/family/member-colors";

describe("memberColorTokens", () => {
  it("gives members the palette's colours in family order, keyed by lowercased id", () => {
    const colors = memberColorTokens([{ memberId: "A" }, { memberId: "b" }, { memberId: "c" }]);

    expect([...colors]).toEqual([
      ["a", "member.1"],
      ["b", "member.2"],
      ["c", "member.3"],
    ]);
  });

  it("gives members past the eighth a shared neutral colour instead of repeating a hue", () => {
    const members = Array.from({ length: 10 }, (_, index) => ({ memberId: `m${index}` }));
    const colors = memberColorTokens(members);

    expect(colors.get("m7")).toBe("member.8");
    expect(colors.get("m8")).toBe(OTHER_MEMBER_COLOR);
    expect(colors.get("m9")).toBe(OTHER_MEMBER_COLOR);
  });

  it("lets a chosen colour win, and gives automatic members the lowest colours nobody chose", () => {
    const colors = memberColorTokens([
      { memberId: "a", color: null },
      { memberId: "b", color: 1 },
      { memberId: "c" },
      { memberId: "d", color: 3 },
      { memberId: "e", color: null },
    ]);

    expect([...colors]).toEqual([
      ["a", "member.2"],
      ["b", "member.1"],
      ["c", "member.4"],
      ["d", "member.3"],
      ["e", "member.5"],
    ]);
  });

  it("falls back to the shared neutral colour when no unchosen colour is left", () => {
    const chosen = Array.from({ length: 7 }, (_, index) => ({ memberId: `c${index}`, color: index + 2 }));
    const colors = memberColorTokens([{ memberId: "x" }, { memberId: "y" }, ...chosen]);

    expect(colors.get("x")).toBe("member.1");
    expect(colors.get("y")).toBe(OTHER_MEMBER_COLOR);
    expect(colors.get("c6")).toBe("member.8");
  });

  it("ignores a colour outside the palette", () => {
    const colors = memberColorTokens([{ memberId: "a", color: 12 }, { memberId: "b", color: 0 }]);

    expect([...colors.values()]).toEqual(["member.1", "member.2"]);
  });
});
