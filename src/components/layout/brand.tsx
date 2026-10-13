import { Flex, Icon, Text } from "@chakra-ui/react";
import { Landmark } from "lucide-react";

import { ICON } from "@/components/ui/icon";

export function Brand() {
  return (
    <Flex align="center" gap="2" minW="0">
      <Icon color="fg.accent" boxSize={`${ICON.nav}px`} aria-hidden="true">
        <Landmark strokeWidth={1.75} />
      </Icon>
      <Text textStyle="sectionTitle" truncate>
        Simple Ledger
      </Text>
    </Flex>
  );
}
