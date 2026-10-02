"use client";

import {
  Alert,
  Badge,
  Box,
  Button,
  Flex,
  Heading,
  Link as ChakraLink,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ArrowRight, CircleAlert, Landmark, WalletCards } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import useSWR from "swr";

import { AddNetWorthItemDialog } from "@/components/net-worth/add-net-worth-item-dialog";
import { AddNetWorthValuationDialog } from "@/components/net-worth/add-net-worth-valuation-dialog";
import { EditNetWorthItemDialog } from "@/components/net-worth/edit-net-worth-item-dialog";
import { NetWorthValue } from "@/components/net-worth/net-worth-value";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { apiFetcher } from "@/lib/api/client";
import { ACCOUNT_API_KEY, NET_WORTH_API_KEY } from "@/lib/api/keys";
import type { AccountData } from "@/lib/types";
import {
  netWorthCategoryLabel,
  type NetWorthEntry,
  type NetWorthOverview,
  type NetWorthTotal,
} from "@/lib/net-worth/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";
import { formatDate, formatDateTime } from "@/lib/utils/dates";
import { useDocumentTitle } from "@/hooks/use-document-title";

function entryAnchor(id: string) {
  return `net-worth-entry-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function groupedEntries(entries: NetWorthEntry[]) {
  const groups = new Map<string, NetWorthEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.category);
    if (group) group.push(entry);
    else groups.set(entry.category, [entry]);
  }

  const categoryOrder = ["investments", "cash", "property", "jewelry", "debt"];
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const leftIndex = categoryOrder.indexOf(left);
      const rightIndex = categoryOrder.indexOf(right);
      if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    })
    .map(([category, categoryEntries]) => ({
      category,
      entries: categoryEntries.toSorted((left, right) => left.name.localeCompare(right.name)),
    }));
}

function totalStatus(total: NetWorthTotal) {
  return total.status === "complete" ? "Complete" : "Incomplete";
}

function NetWorthSummaryCard({ total }: { total: NetWorthTotal }) {
  const netWorth = total.netWorth === null
    ? "Partial"
    : formatInvestmentAmount(total.netWorth, total.currency);

  return (
    <Surface p={{ base: "5", md: "6" }}>
      <Flex align="flex-start" justify="space-between" gap="3">
        <Stack minW="0" gap="1">
          <Flex align="center" gap="2">
            <Text color="muted" fontSize="xs" fontWeight="600" letterSpacing="0.08em">
              Net worth ({total.currency})
            </Text>
            <Badge
              colorPalette={total.status === "complete" ? "green" : "orange"}
              variant="subtle"
              borderRadius="full"
              fontSize="2xs"
            >
              {totalStatus(total)}
            </Badge>
          </Flex>
          <Text mt="1" color={total.netWorth === null ? "orange.700" : "fg"} fontSize="1.5rem" fontWeight="600" letterSpacing="-0.045em" lineHeight="1.1" overflowWrap="anywhere">
            {netWorth}
          </Text>
          {total.netWorth === null ? (
            <Text color="orange.700" fontSize="xs" fontWeight="600">
              Partial known subtotal {formatInvestmentAmount(total.knownSubtotal, total.currency)}
            </Text>
          ) : null}
        </Stack>

      </Flex>

      <SimpleGrid columns={2} gap="3" mt="5">
        <Box>
          <Text color="muted" fontSize="xs" fontWeight="600">Assets</Text>
          <Text mt="1" color="fg" fontSize="sm" fontWeight="600" overflowWrap="anywhere">
            {formatInvestmentAmount(total.assets, total.currency)}
          </Text>
        </Box>
        <Box>
          <Text color="muted" fontSize="xs" fontWeight="600">Liabilities</Text>
          <Text mt="1" color="fg" fontSize="sm" fontWeight="600" overflowWrap="anywhere">
            {formatInvestmentAmount(total.liabilities, total.currency)}
          </Text>
        </Box>
      </SimpleGrid>

      {total.missingValueCount > 0 ? (
        <Text mt="4" color="orange.700" fontSize="xs" fontWeight="600">
          {total.missingValueCount} value{total.missingValueCount === 1 ? "" : "s"} need attention before this total is complete.
        </Text>
      ) : null}
    </Surface>
  );
}

function entryStatus(entry: NetWorthEntry) {
  if (entry.status === "current") return { label: "Current quote", colorPalette: "green" as const };
  if (entry.status === "manual") return { label: "Manual value", colorPalette: "purple" as const };
  if (entry.status === "currency_mismatch") return { label: "Currency mismatch", colorPalette: "orange" as const };
  if (entry.status === "missing_quote") return { label: "Quote unavailable", colorPalette: "orange" as const };
  return { label: "Value needed", colorPalette: "orange" as const };
}

function entryDate(entry: NetWorthEntry) {
  if (!entry.valuedOn) return "No valuation date";
  return entry.source === "investment"
    ? `Quote as of ${formatDateTime(entry.valuedOn)}`
    : `Valued ${formatDate(entry.valuedOn)}`;
}

function NetWorthEntryRow({ entry }: { entry: NetWorthEntry }) {
  const status = entryStatus(entry);

  return (
    <Box id={entryAnchor(entry.id)} p={{ base: "4", md: "5" }} borderWidth="1px" borderColor="border" borderRadius="2xl" bg="white">
      <Flex align={{ base: "stretch", lg: "center" }} justify="space-between" gap="5" direction={{ base: "column", lg: "row" }}>
        <Stack minW="0" gap="1.5">
          <Flex align="center" gap="2" wrap="wrap">
            <Text color="fg" fontWeight="600" wordBreak="break-word">{entry.name}</Text>
            <Badge colorPalette={status.colorPalette} variant="subtle" borderRadius="full" fontSize="2xs">
              {status.label}
            </Badge>
          </Flex>
          <Flex align="center" gap="2" wrap="wrap" color="muted" fontSize="xs">
            {entry.reference ? <Text fontWeight="600">{entry.reference}</Text> : null}
            {entry.reference ? <Text aria-hidden="true">·</Text> : null}
            <Text>{entry.currency}</Text>
            <Text aria-hidden="true">·</Text>
            <Text>{entryDate(entry)}</Text>
          </Flex>
        </Stack>

        <Flex align={{ base: "stretch", lg: "center" }} gap="4" direction={{ base: "column", sm: "row" }}>
          <Text color="fg" fontSize={{ base: "lg", md: "xl" }} fontWeight="600" textAlign={{ base: "left", sm: "right" }} wordBreak="break-word">
            <NetWorthValue entry={entry} />
          </Text>
          {entry.source === "investment" ? (
            <Button asChild minH="11" size="sm" variant="outline" borderRadius="xl" flexShrink="0">
              <Link href="/investments">View investment <ArrowRight size={15} aria-hidden="true" /></Link>
            </Button>
          ) : (
            <Flex gap="2" wrap="wrap" flexShrink="0">
              <AddNetWorthValuationDialog entry={entry} onSuccess={() => undefined} />
              <EditNetWorthItemDialog entry={entry} onSuccess={() => undefined} />
            </Flex>
          )}
        </Flex>
      </Flex>
    </Box>
  );
}

function NetWorthCategorySection({
  category,
  entries,
}: {
  category: string;
  entries: NetWorthEntry[];
}) {
  return (
    <Surface as="section" aria-labelledby={`net-worth-category-${category}`} p={{ base: "5", md: "6" }}>
      <Stack gap="4">
        <Flex align={{ base: "flex-start", sm: "center" }} justify="space-between" gap="3" direction={{ base: "column", sm: "row" }}>
          <Stack gap="1">
            <Heading as="h2" id={`net-worth-category-${category}`} size={{ base: "lg", md: "xl" }} letterSpacing="-0.03em">
              {netWorthCategoryLabel(category)}
            </Heading>
            <Text color="muted" fontSize="sm">
              {entries.length} {entries.length === 1 ? "entry" : "entries"}
            </Text>
          </Stack>
          {category === "investments" ? (
            <ChakraLink asChild color="accent" fontSize="sm" fontWeight="600" _hover={{ textDecoration: "none", color: "accent" }}>
              <Link href="/investments">Manage investments <ArrowRight size={15} aria-hidden="true" /></Link>
            </ChakraLink>
          ) : null}
        </Flex>
        <Stack gap="3">
          {entries.map((entry) => <NetWorthEntryRow key={entry.id} entry={entry} />)}
        </Stack>
      </Stack>
    </Surface>
  );
}

function AttentionArea({ overview }: { overview: NetWorthOverview }) {
  if (!overview.attention.length) return null;

  return (
    <Alert.Root status="warning" borderRadius="2xl">
      <Alert.Indicator />
      <Stack minW="0" gap="2">
        <Text fontWeight="600">Some figures need attention</Text>
        <Stack gap="1">
          {overview.attention.map((item) => (
            <Flex key={item.id} align="flex-start" gap="2" fontSize="sm" wrap="wrap">
              <CircleAlert size={15} aria-hidden="true" />
              <Text>{item.message}{item.currency ? ` · ${item.currency}` : ""}</Text>
              {item.source === "investment" ? (
                <ChakraLink asChild color="orange.800" fontWeight="600" whiteSpace="nowrap">
                  <Link href="/investments">Review</Link>
                </ChakraLink>
              ) : item.entryId ? (
                <ChakraLink asChild color="orange.800" fontWeight="600" whiteSpace="nowrap">
                  <Link href={`#${entryAnchor(item.entryId)}`}>Open</Link>
                </ChakraLink>
              ) : null}
            </Flex>
          ))}
        </Stack>
      </Stack>
    </Alert.Root>
  );
}

function EmptyNetWorth() {
  return (
    <Surface p="4">
      <Flex minH="12rem" align="center" justify="center" textAlign="center">
        <Stack align="center" gap="4">
          <Flex width="8" height="8" align="center" justify="center" color="muted">
            <Landmark size={25} aria-hidden="true" />
          </Flex>
          <Stack align="center" gap="1.5">
            <Heading as="h2" size="lg" letterSpacing="-0.025em">Build your balance sheet</Heading>
            <Text maxW="30rem" color="muted" fontSize="sm">
              Add cash, property, jewelry, debts or a custom asset. Investment holdings will appear automatically when they have an active position.
            </Text>
          </Stack>
        </Stack>
      </Flex>
    </Surface>
  );
}

export function NetWorthPanel() {
  useDocumentTitle("Net worth");
  const { data, error, isLoading, isValidating, mutate } = useSWR<NetWorthOverview>(NET_WORTH_API_KEY, apiFetcher);
  const { data: account } = useSWR<AccountData>(ACCOUNT_API_KEY);
  const grouped = useMemo(() => groupedEntries(data?.entries ?? []), [data?.entries]);

  if (isLoading && !data) return <DataLoading label="Loading your net worth…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your net worth…" />;

  const hasEntries = data.entries.length > 0;

  return (
    <Stack gap={{ base: "6", md: "7" }}>
      <PageHeader title="Net worth"><AddNetWorthItemDialog defaultCurrency={account?.currency ?? "EUR"} onSuccess={() => undefined} /></PageHeader>
      <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />

      <AttentionArea overview={data} />

      {data.totalsByCurrency.length ? (
        <SimpleGrid columns={{ base: 1, sm: 2, xl: 3 }} gap={{ base: "3", md: "4" }}>
          {data.totalsByCurrency.map((total) => <NetWorthSummaryCard key={total.currency} total={total} />)}
        </SimpleGrid>
      ) : null}

      {!hasEntries ? <EmptyNetWorth /> : (
        <Stack gap={{ base: "5", md: "6" }}>
          {grouped.map((group) => <NetWorthCategorySection key={group.category} {...group} />)}
        </Stack>
      )}

      {data.totalsByCurrency.length > 1 ? (
        <Flex align="center" gap="2" color="muted" fontSize="xs">
          <WalletCards size={14} aria-hidden="true" /> Values stay in native currencies; no FX conversion is applied.
        </Flex>
      ) : null}
    </Stack>
  );
}
