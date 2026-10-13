/** Inputs keep a 16px font below the `md` breakpoint so iOS does not zoom on focus. */
export const mobileInputFont = {
  "@media (max-width: 47.99rem)": { fontSize: "lg" },
} as const;

/**
 * On touch screens, small controls keep their visual size but get a 40px
 * transparent hit area.
 */
export const coarseHitArea = {
  "@media (pointer: coarse)": {
    _before: {
      content: '""',
      position: "absolute",
      top: "50%",
      left: "50%",
      width: "max(100%, 2.5rem)",
      height: "max(100%, 2.5rem)",
      transform: "translate(-50%, -50%)",
    },
  },
} as const;
