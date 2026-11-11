"use client";

import { Flex, Portal, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { useLazyMenu } from "@/components/ui/lazy-menu";
import { ToggleChip } from "@/components/ui/toggle-chip";

export type ChipMenuItem = { value: string; label: ReactNode };

/**
 * A chip that opens a menu of choices and shows the current one: "Today ▾", "Groceries ▾". The
 * one-tap way to change a default in a sheet, instead of a select. `selected` makes it look chosen
 * (a value is set); without it, it reads as a default left alone.
 */
export function ChipMenu({
  label,
  items,
  onSelect,
  selected = true,
  "aria-label": ariaLabel,
}: {
  label: ReactNode;
  items: readonly ChipMenuItem[];
  onSelect?: (value: string) => void;
  selected?: boolean;
  /** The chip's name when its label alone doesn't say what it chooses ("Category: Groceries"). */
  "aria-label"?: string;
}) {
  const { parts, placeholder, holdPlain, takeFocus, asked } = useLazyMenu();
  const chipContents = (
    <>
      {label}
      <Text as="span" aria-hidden="true" color="fg.muted">
        ▾
      </Text>
    </>
  );
  const Menu = parts?.Menu;
  if (!Menu) {
    return (
      <ToggleChip ref={holdPlain} {...placeholder} selected={selected} aria-label={ariaLabel}>
        {chipContents}
      </ToggleChip>
    );
  }
  return (
    <Menu.Root positioning={{ placement: "bottom-start" }} defaultOpen={asked} onSelect={({ value }) => onSelect?.(value)}>
      <Menu.Trigger asChild>
        <ToggleChip ref={takeFocus} selected={selected} aria-label={ariaLabel}>
          {chipContents}
        </ToggleChip>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="44" maxH="72" overflowY="auto">
            {items.map((item) => (
              <Menu.Item key={item.value} value={item.value}>
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

/** A sideways-scrolling row of chips that bleeds to the screen edge on phones (suggestions, filters). */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Flex
      role="group"
      aria-label={label}
      gap="2"
      overflowX="auto"
      mx={{ base: "-4", md: "0" }}
      px={{ base: "4", md: "0" }}
      py="1"
      css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
    >
      {children}
    </Flex>
  );
}
