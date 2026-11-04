import { PHONE_QUERY } from "@/hooks/use-is-phone";

/** Below Chakra's `md` breakpoint (48rem, 768 px): a phone, as `useIsPhone()` sees it. */
export const PHONE = `@media ${PHONE_QUERY}`;

/** Inputs keep a 16px font below the `md` breakpoint so iOS does not zoom on focus. */
export const mobileInputFont = {
  [PHONE]: { fontSize: "lg" },
} as const;

/**
 * On touch screens, small controls keep their visual size but get a 44px
 * transparent hit area.
 */
export const coarseHitArea = {
  "@media (pointer: coarse)": {
    _before: {
      content: '""',
      position: "absolute",
      top: "50%",
      left: "50%",
      width: "max(100%, 2.75rem)",
      height: "max(100%, 2.75rem)",
      transform: "translate(-50%, -50%)",
    },
  },
} as const;

/** Fields are 44px tall below `md` (a touch target), where they also use a 16px font. */
export const mobileFieldHeight = (variable: `--${string}`) => ({
  [PHONE]: { [variable]: "sizes.11" } as Record<`--${string}`, string>,
});

/** A control's height and minimum width: 44px on phones, `desktop` (a size token) from `md` up. */
export const touchSize = (desktop: string) => ({
  h: { base: "11", md: desktop },
  minW: { base: "11", md: desktop },
});
