"use client";

import { chakra, type HTMLChakraProps } from "@chakra-ui/react";
import { forwardRef } from "react";

import { chipRecipe } from "@/components/ui/theme/recipes/misc";

const Chip = chakra("button", chipRecipe);

export type ToggleChipProps = Omit<HTMLChakraProps<"button">, "css"> & {
  /** A toggle: sets `aria-pressed`. */
  pressed?: boolean;
  /** Looks chosen without being a toggle (a menu trigger showing its current choice). */
  selected?: boolean;
};

/**
 * A pill from the theme's chip recipe: a filter, a member, a lead time, a quick-add choice. 36px
 * tall on phones with a 44px hit area, and it presses in on tap. `pressed` makes it a toggle.
 */
export const ToggleChip = forwardRef<HTMLButtonElement, ToggleChipProps>(function ToggleChip({ pressed, selected, ...props }, ref) {
  return <Chip ref={ref} type="button" aria-pressed={pressed} data-selected={selected ? "" : undefined} {...props} />;
});
