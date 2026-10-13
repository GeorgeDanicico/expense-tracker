"use client";

import { SegmentGroup } from "@chakra-ui/react";

/** Two-to-five option switcher (view modes, period presets). 28 or 32px tall. */
export function SegmentedControl<T extends string>({
  items,
  value,
  onValueChange,
  size = "sm",
  fullWidth = false,
  name,
  "aria-label": ariaLabel,
}: {
  items: readonly { value: T; label: string; ariaLabel?: string }[];
  value: T;
  onValueChange: (value: T) => void;
  size?: "xs" | "sm";
  /** Stretch to the container; pass `{ base: true, md: false }` for mobile only. */
  fullWidth?: boolean | Partial<Record<"base" | "sm" | "md", boolean>>;
  name?: string;
  "aria-label": string;
}) {
  const width =
    typeof fullWidth === "boolean"
      ? fullWidth ? "full" : "auto"
      : Object.fromEntries(
          Object.entries(fullWidth).map(([breakpoint, on]) => [breakpoint, on ? "full" : "auto"]),
        );
  return (
    <SegmentGroup.Root
      value={value}
      onValueChange={(details) => {
        if (details.value) onValueChange(details.value as T);
      }}
      size={size}
      name={name}
      aria-label={ariaLabel}
      width={width}
    >
      <SegmentGroup.Indicator />
      {items.map((item) => (
        <SegmentGroup.Item key={item.value} value={item.value} flex={fullWidth ? "1" : undefined}>
          <SegmentGroup.ItemText aria-label={item.ariaLabel}>{item.label}</SegmentGroup.ItemText>
          <SegmentGroup.ItemHiddenInput />
        </SegmentGroup.Item>
      ))}
    </SegmentGroup.Root>
  );
}
