import { Text } from "@chakra-ui/react";
import NextLink from "next/link";
import type { ReactNode } from "react";

/**
 * A card's link to its section ("Insights", "All reminders"): accent text, not a button, so a
 * screen keeps its one primary action. Meant for `Card.Header`'s `actions`. Its touch area is taller
 * than the line it takes (the negative margin), so the header stays compact.
 */
export function SectionLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <NextLink href={href}>
      <Text as="span" textStyle="bodySm" fontWeight="medium" color="fg.accent" px="2" py="3" my="-3" display="inline-block">
        {children}
      </Text>
    </NextLink>
  );
}
