import { Button, Flex, Stack, Text } from "@chakra-ui/react";
import Link from "next/link";

import { AddNetWorthValuationDialog } from "@/components/net-worth/add-net-worth-valuation-dialog";
import { EditNetWorthItemDialog } from "@/components/net-worth/edit-net-worth-item-dialog";
import { NetWorthValue } from "@/components/net-worth/net-worth-value";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import type { NetWorthEntry } from "@/lib/net-worth/types";
import { formatDate, formatDateTime } from "@/lib/utils/dates";

export function entryAnchor(id: string) {
  return `net-worth-entry-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function entryStatus(entry: NetWorthEntry): { label: string; tone: StatusTone } {
  if (entry.status === "current") return { label: "Current quote", tone: "positive" };
  if (entry.status === "manual") return { label: "Manual value", tone: "neutral" };
  if (entry.status === "currency_mismatch") return { label: "Currency mismatch", tone: "warning" };
  if (entry.status === "missing_quote") return { label: "Quote unavailable", tone: "warning" };
  return { label: "Value needed", tone: "warning" };
}

function entryDate(entry: NetWorthEntry) {
  if (!entry.valuedOn) return "No valuation date";
  return entry.source === "investment"
    ? `Quote as of ${formatDateTime(entry.valuedOn)}`
    : `Valued ${formatDate(entry.valuedOn)}`;
}

/** One balance-sheet line: name, status, meta, value with change, and actions. */
export function NetWorthEntryRow({ entry }: { entry: NetWorthEntry }) {
  const status = entryStatus(entry);
  const meta = [entry.reference, entry.currency, entryDate(entry)].filter(Boolean).join(" · ");

  return (
    <Flex
      id={entryAnchor(entry.id)}
      as="li"
      py="3"
      gap={{ base: "2", md: "4" }}
      align={{ base: "stretch", md: "center" }}
      justify="space-between"
      direction={{ base: "column", md: "row" }}
      scrollMarginTop="4"
    >
      <Stack minW="0" gap="0.5">
        <Flex align="center" gap="2" wrap="wrap">
          <Text textStyle="bodySm" fontWeight="medium" wordBreak="break-word">{entry.name}</Text>
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        </Flex>
        <Text textStyle="caption">{meta}</Text>
      </Stack>

      <Flex align="center" gap="3" justify={{ base: "space-between", md: "flex-end" }} wrap="wrap">
        <Text textStyle="amount" textAlign={{ base: "start", md: "end" }} wordBreak="break-word">
          <NetWorthValue entry={entry} />
        </Text>
        {entry.source === "investment" ? (
          <Button asChild size="xs" variant="ghost" color="fg.muted" flexShrink="0">
            <Link href="/investments">View investment →</Link>
          </Button>
        ) : (
          <Flex gap="1" flexShrink="0">
            <AddNetWorthValuationDialog entry={entry} onSuccess={() => undefined} />
            <EditNetWorthItemDialog entry={entry} onSuccess={() => undefined} />
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
