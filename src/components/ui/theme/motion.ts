import { defineKeyframes, defineTokens } from "@chakra-ui/react";

/**
 * The motion tokens ("Motion" in docs/ui-direction.md). Components use the token names
 * (`transitionDuration="fast"`, `"opacity {durations.fast} {easings.standard}"`), never a literal
 * duration or easing (`local/motion-tokens`), so the reduced-motion block in `global-css.ts` turns
 * every one of them off.
 *
 * In milliseconds, for the few things JavaScript times itself (the count-up, a hand-off after the
 * save check). Ask `useReducedMotion()` first: under reduced motion the change happens at once.
 */
export const DURATION_MS = {
  /** Buttons, rows and chips pressing in. */
  press: 90,
  /** Hover tints and hover actions. */
  fast: 120,
  /** Indicators, collapses, toasts, the scrim, the desktop dialog. */
  moderate: 200,
  /** Sheets, new rows, the save check, meters. */
  slow: 300,
  /** The month total counting up (JavaScript). */
  countUp: 450,
} as const;

export const EASINGS = {
  /** Things that move on screen (indicators, collapses, toasts, press). */
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  /** Things that arrive (a sheet opening, a new row). */
  enter: "cubic-bezier(0.05, 0.7, 0.1, 1)",
  /** Things that leave (a sheet closing). */
  exit: "cubic-bezier(0.3, 0, 0.8, 0.15)",
} as const;

/** How far each element presses in on tap. */
export const PRESS_SCALE = { control: "0.97", chip: "0.95", icon: "0.92" } as const;

export const durations = defineTokens.durations(
  Object.fromEntries(Object.entries(DURATION_MS).map(([name, ms]) => [name, { value: `${ms}ms` }])),
);

export const easings = defineTokens.easings(
  Object.fromEntries(Object.entries(EASINGS).map(([name, value]) => [name, { value }])),
);

/**
 * The app's own keyframes, beside Chakra's (`fade-in`, `scale-in`, `slide-from-top` and the rest).
 * They animate `translate` and `scale`, which compose with a `transform` set on the element (the
 * sheet's drag offset), and only those and `opacity`.
 */
export const keyframes = defineKeyframes({
  "sheet-in": { from: { translate: "0 105%" }, to: { translate: "0 0" } },
  "sheet-out": { from: { translate: "0 0" }, to: { translate: "0 105%" } },
  "pop-in": { from: { opacity: "0", scale: "0.96" }, to: { opacity: "1", scale: "1" } },
  "pop-out": { from: { opacity: "1", scale: "1" }, to: { opacity: "0", scale: "0.96" } },
});

/** A `transition` value for one or more properties, from the tokens: `transition("opacity", "fast")`. */
export function transition(properties: string, duration: keyof typeof DURATION_MS, easing: keyof typeof EASINGS = "standard") {
  return properties
    .split(",")
    .map((property) => `${property.trim()} {durations.${duration}} {easings.${easing}}`)
    .join(", ");
}

/**
 * Press feedback for a recipe: a small scale on tap, under 100 ms. `scale` (not `transform`) so it
 * composes with a transform the element already has.
 */
export function pressFeedback(scale: string = PRESS_SCALE.control) {
  return {
    transitionProperty: "scale, background-color, border-color, color, box-shadow, opacity",
    transitionDuration: "press",
    transitionTimingFunction: "standard",
    "&:not(:disabled, [data-disabled], [aria-disabled=true]):active": { scale },
  } as const;
}
