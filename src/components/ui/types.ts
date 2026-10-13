/**
 * Props that primitives never accept: colour, radius, and type overrides
 * belong to the theme, not to call sites.
 */
type StyleOverrideProps =
  | "color"
  | "bg"
  | "bgColor"
  | "background"
  | "borderColor"
  | "borderRadius"
  | "rounded"
  | "fontSize"
  | "fontWeight"
  | "letterSpacing"
  | "textStyle";

export type WithoutStyleOverrides<T> = Omit<T, StyleOverrideProps>;
