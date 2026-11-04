import { Box, chakra, Flex, Text } from "@chakra-ui/react";
import type { ComponentProps, ReactNode } from "react";

import { rowRecipe } from "@/components/ui/theme/recipes/misc";

/** A list item with the theme's row recipe: 56px tall on phones, no line between rows. */
const RowItem = chakra("li", rowRecipe);

/**
 * Mobile list row: leading icon, title, meta line, trailing amount/actions. Other props go on the
 * `li` (`useRowActions().rowProps` for the long-press menu).
 * `accent` is a colour token drawn as a bar down the row's start edge (a family member's colour).
 */
export function ListRow({
  accent,
  leading,
  title,
  meta,
  detail,
  trailing,
  actions,
  ...rowProps
}: Omit<ComponentProps<"li">, "title" | "children"> & {
  accent?: string;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  /** Optional second caption line (e.g. notes). */
  detail?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <RowItem listStyleType="none" {...rowProps}>
      {accent ? <Box alignSelf="stretch" flexShrink="0" width="1" borderRadius="full" bg={accent} aria-hidden="true" /> : null}
      {leading}
      <Flex direction="column" flex="1" minW="0" gap="0.5">
        <Text textStyle="bodySm" fontWeight="medium" truncate>
          {title}
        </Text>
        {meta ? (
          <Text textStyle="caption" truncate>
            {meta}
          </Text>
        ) : null}
        {detail ? (
          <Text textStyle="caption" truncate>
            {detail}
          </Text>
        ) : null}
      </Flex>
      {trailing || actions ? (
        <Flex align="center" gap="1" flexShrink="0">
          {trailing}
          {actions}
        </Flex>
      ) : null}
    </RowItem>
  );
}
