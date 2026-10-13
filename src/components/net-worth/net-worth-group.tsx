import { Stack } from "@chakra-ui/react";

import { CardLink } from "@/components/ui/card-link";
import { NetWorthEntryRow } from "@/components/net-worth/net-worth-entry-row";
import { Card } from "@/components/ui/card";
import { netWorthCategoryLabel, type NetWorthEntry } from "@/lib/net-worth/types";

/** A balance-sheet category (Cash, Property, …) with its entry rows. */
export function NetWorthGroup({
  category,
  entries,
}: {
  category: string;
  entries: NetWorthEntry[];
}) {
  const headingId = `net-worth-category-${category}`;
  return (
    <Card as="section" aria-labelledby={headingId}>
      <Card.Header
        id={headingId}
        title={netWorthCategoryLabel(category)}
        description={`${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
        actions={category === "investments" ? <CardLink href="/investments">Manage investments</CardLink> : undefined}
      />
      <Card.Body pt="1" pb="1">
        <Stack as="ul" gap="0" listStyleType="none" divideY="1px" divideColor="border">
          {entries.map((entry) => <NetWorthEntryRow key={entry.id} entry={entry} />)}
        </Stack>
      </Card.Body>
    </Card>
  );
}
