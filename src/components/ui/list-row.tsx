import { Box, Flex, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * Mobile list row: leading icon, title, meta line, trailing amount/actions.
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
}: {
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
    <Flex
      as="li"
      align="center"
      gap="3"
      py="2.5"
      borderBottomWidth="1px"
      borderColor="border"
      _last={{ borderBottomWidth: "0" }}
      listStyleType="none"
    >
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
    </Flex>
  );
}
