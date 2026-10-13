import { Flex, Link as ChakraLink, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";

import { entryAnchor } from "@/components/net-worth/net-worth-entry-row";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { NetWorthOverview } from "@/lib/net-worth/types";

/** Warning listing entries that keep a total incomplete. */
export function NetWorthAttention({ overview }: { overview: NetWorthOverview }) {
  if (!overview.attention.length) return null;

  return (
    <InlineAlert status="warning" title="Some figures need attention">
      <Stack as="span" gap="0.5" mt="1" display="flex">
        {overview.attention.map((item) => (
          <Flex as="span" key={item.id} align="baseline" gap="2" wrap="wrap">
            <Text as="span">{item.message}{item.currency ? ` · ${item.currency}` : ""}</Text>
            {item.source === "investment" ? (
              <ChakraLink asChild color="fg.warning" fontWeight="medium" textDecoration="underline" whiteSpace="nowrap">
                <Link href="/investments">Review</Link>
              </ChakraLink>
            ) : item.entryId ? (
              <ChakraLink asChild color="fg.warning" fontWeight="medium" textDecoration="underline" whiteSpace="nowrap">
                <Link href={`#${entryAnchor(item.entryId)}`}>Open</Link>
              </ChakraLink>
            ) : null}
          </Flex>
        ))}
      </Stack>
    </InlineAlert>
  );
}
