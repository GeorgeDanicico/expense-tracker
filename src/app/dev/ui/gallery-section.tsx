import { Flex, Stack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export function GallerySection({
  title,
  description,
  id,
  children,
}: {
  title: string;
  /** An anchor, for links and screenshots (`/dev/ui#mobile`). */
  id?: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card id={id}>
      <Card.Header title={title} description={description} />
      <Card.Body>
        <Stack gap="4">{children}</Stack>
      </Card.Body>
    </Card>
  );
}

export function GalleryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Flex direction={{ base: "column", md: "row" }} gap={{ base: "2", md: "4" }} align={{ md: "center" }}>
      <Text textStyle="caption" width={{ md: "8rem" }} flexShrink="0">
        {label}
      </Text>
      <Flex gap="2" wrap="wrap" align="center" minW="0" flex="1">
        {children}
      </Flex>
    </Flex>
  );
}
