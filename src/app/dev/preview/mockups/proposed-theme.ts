import type { SystemStyleObject } from "@chakra-ui/react";

/**
 * PROPOSALS FOR U4, NOT THEME TOKENS YET.
 *
 * The radii, spacing, motion and touch sizes from docs/ui-direction.md, as U3's mockups and the
 * Motion section of /dev/ui use them. This is the only file with the literal values: U4 moves them
 * into src/components/ui/theme (tokens, recipes, global-css.ts) once George signs the direction
 * off, and deletes this file. Nothing outside src/app/dev reads it.
 *
 * The values are CSS variables set on a wrapper (`proposedScope`, applied by `ProposedThemeScope`),
 * so the real primitives inside it pick up the proposed radii through the theme's own variables and
 * the global theme doesn't change. Colours are not here: they stay as they are.
 */

/** Four radius steps, the same at every breakpoint (today: badge 4, control 6, card 10, dialog 12). */
export const PROPOSED_RADII = {
  /** Buttons, inputs, selects, segmented controls, sidebar links, icon tiles. */
  control: "0.625rem",
  /** Cards, grouped lists, desktop dialogs, toasts, the + button. */
  card: "1rem",
  /** The top corners of a bottom sheet (phones only). */
  sheet: "1.375rem",
  /** Chips, deltas, the bottom bar's indicator, round icon buttons. */
  pill: "9999px",
} as const;

/** Durations. `countUp` is read by JavaScript (`PROPOSED_COUNT_UP_MS`); the rest by CSS. */
export const PROPOSED_DURATIONS = {
  press: "90ms",
  fast: "120ms",
  moderate: "200ms",
  slow: "300ms",
  countUp: "450ms",
} as const;

export const PROPOSED_COUNT_UP_MS = 450;

export const PROPOSED_EASINGS = {
  /** Things that move on screen (indicators, collapses, toasts). */
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  /** Things that arrive (a sheet opening, a new row). */
  enter: "cubic-bezier(0.05, 0.7, 0.1, 1)",
  /** Things that leave (a sheet closing). */
  exit: "cubic-bezier(0.3, 0, 0.8, 0.15)",
} as const;

/** Spacing steps per breakpoint, as Chakra spacing tokens (4 = 16px). */
export const PROPOSED_SPACING = {
  /** The page's side padding. */
  pageX: { base: "4", md: "6", lg: "8" },
  pageTop: { base: "3", md: "6" },
  /** Between cards and sections. */
  sectionGap: { base: "4", md: "5" },
  /** Between the two desktop columns. */
  columnGap: { base: "4", lg: "6" },
  /** A list row's minimum height (a 44 px target plus room) and its leading tile. */
  rowMinH: { base: "14", md: "12" },
  tile: { base: "10", md: "9" },
} as const;

/** Touch sizes at the base breakpoint (U4 sets them in the recipes). */
export const PROPOSED_TOUCH = { control: "2.75rem", segment: "2.5rem" } as const;

/** Type: the numbers that matter, larger, inside the existing scale (4xl is 28 px). */
export const PROPOSED_TEXT = {
  hero: { fontSize: "4xl", lineHeight: "2.25rem", fontWeight: "semibold", letterSpacing: "-0.02em" },
  /** The quick-add amount: the one size above the scale (40 px), an open question in the direction doc. */
  amountInput: { fontSize: "2.5rem", lineHeight: "3rem", fontWeight: "semibold", letterSpacing: "-0.02em" },
} as const satisfies Record<string, SystemStyleObject>;

/** Press feedback: a small scale on tap. */
export const PROPOSED_PRESS_SCALE = { control: "0.97", chip: "0.95", icon: "0.92" } as const;

type Duration = keyof typeof PROPOSED_DURATIONS;
type Easing = keyof typeof PROPOSED_EASINGS;

/** `var(--proposed-durations-<name>)`: what a component would write as the `{durations.<name>}` token. */
export const duration = (name: Duration) => `var(--proposed-durations-${name})`;
export const easing = (name: Easing) => `var(--proposed-easings-${name})`;
export const radius = (name: keyof typeof PROPOSED_RADII) => `var(--proposed-radii-${name})`;

/** A `transition` value for one or more properties with one duration and easing. */
export function transition(properties: string, name: Duration, ease: Easing = "standard") {
  return properties
    .split(",")
    .map((property) => `${property.trim()} ${duration(name)} ${easing(ease)}`)
    .join(", ");
}

const vars = (group: string, values: Record<string, string>) =>
  Object.fromEntries(Object.entries(values).map(([name, value]) => [`--proposed-${group}-${name}`, value]));

const INSTANT = Object.fromEntries(Object.keys(PROPOSED_DURATIONS).map((name) => [name, "0ms"])) as Record<Duration, string>;

/** Chakra's own duration variables, so its built-in transitions follow reduced motion too. */
const chakraDurations = (values: Record<Duration, string>) => ({
  "--chakra-durations-fastest": values.fast,
  "--chakra-durations-faster": values.fast,
  "--chakra-durations-fast": values.fast,
  "--chakra-durations-moderate": values.moderate,
  "--chakra-durations-slow": values.slow,
  "--chakra-durations-slower": values.slow,
  "--chakra-durations-slowest": values.slow,
});

const PHONE = "@media (max-width: 47.99rem)";
const PRESSABLE = "& .chakra-button, & [data-pressable]";

/**
 * The CSS for a wrapper that previews the proposals on everything inside it. `reduced` simulates
 * `prefers-reduced-motion: reduce`, which the wrapper also honours on its own: every duration becomes
 * 0 ms, so each change is instant and the action still happens (U4 does this once, in global-css.ts).
 */
export function proposedScope(reduced: boolean): SystemStyleObject {
  const durations = reduced ? INSTANT : PROPOSED_DURATIONS;
  return {
    ...vars("radii", PROPOSED_RADII),
    ...vars("durations", durations),
    ...vars("easings", PROPOSED_EASINGS),
    ...chakraDurations(durations),
    // The primitives' recipes read these, so Button, Input, SegmentedControl and Card get the proposed radii.
    "--chakra-radii-control": PROPOSED_RADII.control,
    "--chakra-radii-card": PROPOSED_RADII.card,
    "--chakra-radii-dialog": PROPOSED_RADII.card,
    "@media (prefers-reduced-motion: reduce)": { ...vars("durations", INSTANT), ...chakraDurations(INSTANT) },

    // Press feedback (U4: in the button, row and chip recipes).
    [PRESSABLE]: {
      transitionProperty: "transform, background-color, border-color, color",
      transitionDuration: duration("press"),
      transitionTimingFunction: easing("standard"),
    },
    "& .chakra-button:not(:disabled):active, & [data-pressable]:active": { transform: `scale(${PROPOSED_PRESS_SCALE.control})` },
    "& [data-pressable=chip]:active": { transform: `scale(${PROPOSED_PRESS_SCALE.chip})` },
    "& [data-pressable=icon]:active": { transform: `scale(${PROPOSED_PRESS_SCALE.icon})` },

    // The segmented control's indicator slides with the proposed token (Zag positions it).
    "& .chakra-segment-group__indicator": {
      "--transition-duration": duration("moderate"),
      "--transition-timing-function": easing("standard"),
    },

    // Fewer borders: cards are separated by space and a soft shadow, not a line.
    "& .chakra-card__root": { borderColor: "transparent" },
    "@media (min-width: 48rem)": { "& .chakra-card__root": { "--card-padding": "spacing.5" } },

    // 44 px touch targets and 16 px inputs on phones (U4: the recipes' base breakpoint).
    [PHONE]: {
      "& .chakra-button": { minHeight: PROPOSED_TOUCH.control, minWidth: PROPOSED_TOUCH.control },
      "& .chakra-input": { "--input-height": PROPOSED_TOUCH.control },
      "& .chakra-segment-group__item": { height: PROPOSED_TOUCH.segment },
    },
  };
}
