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

const WHITE = "#FFFFFF";
const BLACK = "#000000";

/**
 * Text drawn on each member colour (`member.<n>.fg`), e.g. an avatar's initials. Each is whichever
 * of white or black reads better on that slot, and every pair is at least 4.5:1:
 * 1 black 4.76 · 2 black 6.56 · 3 black 7.46 · 4 black 9.70 · 5 black 7.80 · 6 white 4.95 ·
 * 7 white 5.77 · 8 black 5.31. The app has one (light) theme, so these hold everywhere. White fails on six of the eight (blue is 4.42, red 3.95), and the
 * app's ink (#292824) fails on blue (3.34) and red (3.73), so neither works for every slot.
 */
export const MEMBER_FOREGROUNDS = [BLACK, BLACK, BLACK, BLACK, BLACK, WHITE, WHITE, BLACK] as const;

export const memberTokens = Object.fromEntries(
  MEMBER_COLORS.map((value, index) => [
    String(index + 1),
    { DEFAULT: { value }, fg: { value: MEMBER_FOREGROUNDS[index] } },
  ]),
);
