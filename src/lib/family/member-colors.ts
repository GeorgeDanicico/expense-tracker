/** How many members get a colour of their own (`member.1` … `member.8` in the theme). */
export const MEMBER_COLOR_COUNT = 8;

/** The colour members past the eighth share, rather than repeating a hue another member already wears. */
export const OTHER_MEMBER_COLOR = "fg.subtle";

/**
 * Each member's colour token, keyed by lowercased member id. A colour a parent chose (`color`, 1..8)
 * always wins. Members without one are automatic: in the family list's order (the creator first, then
 * other parents, then kids, each by join date) they take the lowest palette colours nobody chose, and
 * once those run out they share `OTHER_MEMBER_COLOR`. So everyone sees the same colour for the same
 * person on every page.
 */
export function memberColorTokens(members: readonly { memberId: string; color?: number | null }[]): Map<string, string> {
  const isSlot = (color: number | null | undefined): color is number =>
    typeof color === "number" && Number.isInteger(color) && color >= 1 && color <= MEMBER_COLOR_COUNT;
  const chosen = members.map((member) => (isSlot(member.color) ? member.color : null));
  const taken = new Set(chosen.filter((color) => color !== null));
  let next = 1;

  return new Map(
    members.map((member, index) => {
      let slot = chosen[index];
      if (slot === null) {
        while (taken.has(next)) next += 1;
        slot = next <= MEMBER_COLOR_COUNT ? next++ : null;
      }
      return [member.memberId.toLowerCase(), slot === null ? OTHER_MEMBER_COLOR : `member.${slot}`];
    }),
  );
}

/** The palette's colour names in slot order (slot 1 is "Blue"), for labels; they match `MEMBER_COLORS`. */
export const MEMBER_COLOR_NAMES = ["Blue", "Orange", "Aqua", "Yellow", "Magenta", "Green", "Violet", "Red"] as const;
