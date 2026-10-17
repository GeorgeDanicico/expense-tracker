"use client";

import { Box, Flex } from "@chakra-ui/react";

import { useMemberColors } from "@/hooks/use-member-colors";

/** A member's colour as a small dot beside their name. Decorative: the name carries who it is. */
export function MemberSwatch({ color, size = "2.5" }: { color: string | undefined; size?: "2" | "2.5" | "3" }) {
  if (!color) return null;
  return <Box as="span" display="inline-block" flexShrink="0" boxSize={size} borderRadius="full" bg={color} aria-hidden="true" />;
}

/** A member's name led by their colour, for headings and labels in the family views. */
export function MemberName({ memberId, name }: { memberId: string; name: string }) {
  const memberColor = useMemberColors();
  return (
    <Flex as="span" display="inline-flex" align="center" gap="2" minW="0">
      <MemberSwatch color={memberColor(memberId)} size="3" />
      {name}
    </Flex>
  );
}
