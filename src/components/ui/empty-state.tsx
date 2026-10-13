import { EmptyState as ChakraEmptyState, Flex } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** Icon, title, description and an optional action for empty or filtered views. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "md",
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md";
}) {
  return (
    <ChakraEmptyState.Root size={size}>
      <ChakraEmptyState.Content textAlign="center">
        {icon ? <ChakraEmptyState.Indicator>{icon}</ChakraEmptyState.Indicator> : null}
        <Flex direction="column" align="center" gap="1">
          <ChakraEmptyState.Title>{title}</ChakraEmptyState.Title>
          {description ? (
            <ChakraEmptyState.Description>{description}</ChakraEmptyState.Description>
          ) : null}
        </Flex>
        {action}
      </ChakraEmptyState.Content>
    </ChakraEmptyState.Root>
  );
}
