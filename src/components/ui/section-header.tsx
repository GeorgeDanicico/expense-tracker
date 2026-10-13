import { Flex, Heading, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Section `<h2>` with optional meta text and trailing actions. */
export function SectionHeader({
  title,
  meta,
  actions,
  as = "h2",
  id,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  as?: "h2" | "h3";
  id?: string;
}) {
  return (
    <Flex align="center" justify="space-between" gap="3" wrap="wrap" minW="0">
      <Flex direction="column" gap="0.5" minW="0">
        <Heading as={as} id={id} size="md">
          {title}
        </Heading>
        {meta ? <Text textStyle="caption">{meta}</Text> : null}
      </Flex>
      {actions ? (
        <Flex align="center" gap="1" flexShrink="0">
          {actions}
        </Flex>
      ) : null}
    </Flex>
  );
}
