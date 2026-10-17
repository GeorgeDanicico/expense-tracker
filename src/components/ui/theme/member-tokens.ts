/**
 * One colour per family member (`member.1` … `member.8`), assigned in this fixed order by
 * `memberColorTokens`. It is a validated categorical palette: neighbours stay apart for colour-blind
 * readers (worst adjacent CVD ΔE 9.1 on white). Three of them are under 3:1 against white, so a
 * member's colour always sits next to their name and never carries identity alone.
 */
export const MEMBER_COLORS = [
  "#2A78D6", // blue
  "#EB6834", // orange
  "#1BAF7A", // aqua
  "#EDA100", // yellow
  "#E87BA4", // magenta
  "#008300", // green
  "#6250D6", // violet
  "#E34948", // red
] as const;

export const memberTokens = Object.fromEntries(
  MEMBER_COLORS.map((value, index) => [String(index + 1), { value }]),
);
