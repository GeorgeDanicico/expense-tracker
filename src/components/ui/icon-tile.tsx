import { Flex, type FlexProps } from "@chakra-ui/react";
import type { LucideIcon } from "lucide-react";

import { ICON } from "@/components/ui/icon";

/**
 * The coloured square in front of a row (40px on phones, 36 on desktop), so a list can be scanned by
 * shape: a category, a reminder, a settings group. Colours are tokens (`category.groceries.bg`).
 */
export function IconTile({ icon: Icon, bg, color }: { icon: LucideIcon; bg: FlexProps["bg"]; color: FlexProps["color"] }) {
  return (
    <Flex boxSize={{ base: "10", md: "9" }} flexShrink="0" align="center" justify="center" borderRadius="control" bg={bg} color={color} aria-hidden="true">
      <Icon size={ICON.nav} />
    </Flex>
  );
}
