"use client";

import {
  IconButton as ChakraIconButton,
  Portal,
  type IconButtonProps as ChakraIconButtonProps,
} from "@chakra-ui/react";
import { cloneElement, forwardRef, type ForwardedRef, type ReactElement } from "react";

import { useLazyTooltip } from "@/components/ui/lazy-menu";
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

function setRef<T>(ref: ForwardedRef<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

/** A square icon-only button. The accessible name is required. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ size = "sm", variant = "ghost", tone = "default", tooltip = false, ...props }, ref) {
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
    return <WithTooltip label={props["aria-label"]} button={button} forwardedRef={ref} />;
  },
);

/**
 * The button with its tooltip. The tooltip's code arrives after the page (`lazy-menu.tsx`); until then
 * this is the plain button, and when it arrives the button is wrapped, keeping the focus it had.
 */
function WithTooltip({ label, button, forwardedRef }: { label: string; button: ReactElement<Record<string, unknown>>; forwardedRef: ForwardedRef<HTMLButtonElement> }) {
  const { parts, placeholder, holdPlain, takeFocus } = useLazyTooltip();
  const toRef = parts ? takeFocus : holdPlain;
  const withRefs = cloneElement(button, {
    ...(parts ? {} : placeholder),
    ref: (element: HTMLButtonElement | null) => {
      setRef(forwardedRef, element);
      toRef(element);
    },
  });
  if (!parts) return withRefs;
  const { Tooltip } = parts;
  return (
    <Tooltip.Root openDelay={400} closeDelay={0} positioning={{ placement: "top" }}>
      <Tooltip.Trigger asChild>{withRefs}</Tooltip.Trigger>
      <Portal>
        <Tooltip.Positioner>
          <Tooltip.Content>{label}</Tooltip.Content>
        </Tooltip.Positioner>
      </Portal>
    </Tooltip.Root>
  );
}
