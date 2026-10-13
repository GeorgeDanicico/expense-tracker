import { Flex, Heading } from "@chakra-ui/react";

export function PageHeader({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Flex align="center" justify="space-between" gap="3" wrap="wrap">
      <Heading as="h1" textStyle="pageTitle">{title}</Heading>
      {children}
    </Flex>
  );
}
