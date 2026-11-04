import { Flex, Heading, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * Page `<h1>` with optional description and actions (under the title on mobile). `inline` keeps the
 * actions beside the title on phones too, for a lone icon button such as a screen's `⋯`.
 */
export function PageHeader({
  title,
  description,
  actions,
  inline = false,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  inline?: boolean;
}) {
  return (
    <Flex
      direction={inline ? "row" : { base: "column", sm: "row" }}
      align={inline ? "center" : { base: "stretch", sm: "center" }}
      justify="space-between"
      gap="3"
    >
      <Flex direction="column" gap="0.5" minW="0">
        <Heading as="h1" size="xl">
          {title}
        </Heading>
        {description ? <Text textStyle="caption">{description}</Text> : null}
      </Flex>
      {actions ? (
        <Flex gap="2" wrap="wrap" align="center" flexShrink="0">
          {actions}
        </Flex>
      ) : null}
    </Flex>
  );
}
