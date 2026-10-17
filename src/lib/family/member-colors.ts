/** How many members get a colour of their own (`member.1` … `member.8` in the theme). */
export const MEMBER_COLOR_COUNT = 8;

/** The colour members past the eighth share, rather than repeating a hue another member already wears. */
export const OTHER_MEMBER_COLOR = "fg.subtle";

/**
 * Each member's colour token, keyed by lowercased member id. Colours follow the family list's order
 * (the creator first, then other parents, then kids, each by join date), so everyone sees the same
 * colour for the same person on every page.
 */
export function memberColorTokens(members: readonly { memberId: string }[]): Map<string, string> {
  return new Map(
    members.map((member, index) => [
      member.memberId.toLowerCase(),
      index < MEMBER_COLOR_COUNT ? `member.${index + 1}` : OTHER_MEMBER_COLOR,
    ]),
  );
}
