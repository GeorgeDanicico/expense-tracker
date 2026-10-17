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
});
