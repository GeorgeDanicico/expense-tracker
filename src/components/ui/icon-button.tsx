"use client";

import {
  IconButton as ChakraIconButton,
  Portal,
  Tooltip,
  type IconButtonProps as ChakraIconButtonProps,
} from "@chakra-ui/react";
import { forwardRef } from "react";

import type { WithoutStyleOverrides } from "@/components/ui/types";

export type IconButtonProps = WithoutStyleOverrides<
  Omit<ChakraIconButtonProps, "size" | "variant" | "colorPalette">
> & {
  "aria-label": string;
  size?: "xs" | "sm";
  variant?: "ghost" | "outline" | "subtle";
  /** `danger` tints the hover state for destructive actions. */
  tone?: "default" | "danger";
  /** Shows the `aria-label` as a tooltip on hover/focus (desktop pointers). */
  tooltip?: boolean;
};

/** A square icon-only button. The accessible name is required. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { size = "sm", variant = "ghost", tone = "default", tooltip = false, ...props },
    ref,
  ) {
    const button = (
      <ChakraIconButton
        ref={ref}
        size={size}
        variant={variant}
        colorPalette={tone === "danger" ? "danger" : "neutral"}
        color={tone === "danger" ? "fg.muted" : undefined}
        _hover={tone === "danger" ? { color: "fg.error" } : undefined}
        {...props}
      />
    );
    if (!tooltip) return button;
    return (
      <Tooltip.Root openDelay={400} closeDelay={0} positioning={{ placement: "top" }}>
        <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
        <Portal>
          <Tooltip.Positioner>
            <Tooltip.Content>
              {props["aria-label"]}
            </Tooltip.Content>
          </Tooltip.Positioner>
        </Portal>
      </Tooltip.Root>
    );
  },
);
