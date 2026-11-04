import { Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/** A small uppercase caption over a group of rows: "Yesterday", "Account". */
export function GroupLabel({ children, px = "1" }: { children: ReactNode; px?: string }) {
  return (
    <Text textStyle="label" color="fg.subtle" textTransform="uppercase" letterSpacing="0.04em" px={px} pt="2" pb="1">
      {children}
    </Text>
  );
}
