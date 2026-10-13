import { Flex, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Mobile list row: leading icon, title, meta line, trailing amount/actions. */
export function ListRow({
  leading,
  title,
  meta,
  trailing,
  actions,
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
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
