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
import { ArrowRight, CircleAlert, Landmark, Scale, WalletCards } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import useSWR from "swr";

import { AddNetWorthItemDialog } from "@/components/net-worth/add-net-worth-item-dialog";
import { AddNetWorthValuationDialog } from "@/components/net-worth/add-net-worth-valuation-dialog";
import { EditNetWorthItemDialog } from "@/components/net-worth/edit-net-worth-item-dialog";
import { NetWorthValue } from "@/components/net-worth/net-worth-value";
import { DataError, DataLoading, DataUpdating } from "@/components/ui/data-state";
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
            <Text color="gray.500" fontSize="xs" fontWeight="800" letterSpacing="0.08em">
              NET WORTH IN {total.currency}
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
          <Text mt="1" color={total.netWorth === null ? "orange.700" : "gray.900"} fontSize={{ base: "2xl", md: "3xl" }} fontWeight="850" letterSpacing="-0.045em" lineHeight="1.1" truncate>
            {netWorth}
          </Text>
          {total.netWorth === null ? (
            <Text color="orange.700" fontSize="xs" fontWeight="650">
              Partial known subtotal {formatInvestmentAmount(total.knownSubtotal, total.currency)}
            </Text>
          ) : null}
        </Stack>
        <Flex width="10" height="10" flexShrink="0" align="center" justify="center" borderRadius="xl" color={total.status === "complete" ? "purple.700" : "orange.700"} bg={total.status === "complete" ? "purple.50" : "orange.50"}>
          <Scale size={19} aria-hidden="true" />
        </Flex>
      </Flex>

      <SimpleGrid columns={2} gap="3" mt="5">
        <Box p="3" borderRadius="xl" bg="gray.50">
          <Text color="gray.500" fontSize="xs" fontWeight="700">ASSETS</Text>
          <Text mt="1" color="gray.900" fontSize="sm" fontWeight="800" truncate>
            {formatInvestmentAmount(total.assets, total.currency)}
          </Text>
        </Box>
        <Box p="3" borderRadius="xl" bg="gray.50">
          <Text color="gray.500" fontSize="xs" fontWeight="700">LIABILITIES</Text>
          <Text mt="1" color="gray.900" fontSize="sm" fontWeight="800" truncate>
            {formatInvestmentAmount(total.liabilities, total.currency)}
          </Text>
        </Box>
      </SimpleGrid>

      {total.missingValueCount > 0 ? (
        <Text mt="4" color="orange.700" fontSize="xs" fontWeight="650">
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
    <Box id={entryAnchor(entry.id)} p={{ base: "4", md: "5" }} borderWidth="1px" borderColor="gray.200" borderRadius="2xl" bg="white">
      <Flex align={{ base: "stretch", lg: "center" }} justify="space-between" gap="5" direction={{ base: "column", lg: "row" }}>
        <Stack minW="0" gap="1.5">
          <Flex align="center" gap="2" wrap="wrap">
            <Text color="gray.900" fontWeight="800" wordBreak="break-word">{entry.name}</Text>
            <Badge colorPalette={status.colorPalette} variant="subtle" borderRadius="full" fontSize="2xs">
              {status.label}
            </Badge>
          </Flex>
          <Flex align="center" gap="2" wrap="wrap" color="gray.500" fontSize="xs">
            {entry.reference ? <Text fontWeight="650">{entry.reference}</Text> : null}
            {entry.reference ? <Text aria-hidden="true">·</Text> : null}
            <Text>{entry.currency}</Text>
            <Text aria-hidden="true">·</Text>
            <Text>{entryDate(entry)}</Text>
          </Flex>
        </Stack>

        <Flex align={{ base: "stretch", lg: "center" }} gap="4" direction={{ base: "column", sm: "row" }}>
          <Text color="gray.900" fontSize={{ base: "lg", md: "xl" }} fontWeight="800" textAlign={{ base: "left", sm: "right" }} wordBreak="break-word">
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
            <Text color="gray.500" fontSize="sm">
              {entries.length} {entries.length === 1 ? "entry" : "entries"} · native currency values
            </Text>
          </Stack>
          {category === "investments" ? (
            <ChakraLink asChild color="purple.700" fontSize="sm" fontWeight="700" _hover={{ textDecoration: "none", color: "purple.900" }}>
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
        <Text fontWeight="800">Some figures need attention</Text>
        <Stack gap="1">
          {overview.attention.map((item) => (
            <Flex key={item.id} align="flex-start" gap="2" fontSize="sm">
              <CircleAlert size={15} aria-hidden="true" />
              <Text>{item.message}{item.currency ? ` · ${item.currency}` : ""}</Text>
              {item.source === "investment" ? (
                <ChakraLink asChild color="orange.800" fontWeight="750" whiteSpace="nowrap">
                  <Link href="/investments">Review</Link>
                </ChakraLink>
              ) : item.entryId ? (
                <ChakraLink asChild color="orange.800" fontWeight="750" whiteSpace="nowrap">
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
    <Surface p={{ base: "8", md: "12" }}>
      <Flex minH="17rem" align="center" justify="center" textAlign="center">
        <Stack align="center" gap="4">
          <Flex width="14" height="14" align="center" justify="center" borderRadius="2xl" color="purple.600" bg="purple.50">
            <Landmark size={25} aria-hidden="true" />
          </Flex>
          <Stack align="center" gap="1.5">
            <Heading as="h2" size="lg" letterSpacing="-0.025em">Build your balance sheet</Heading>
            <Text maxW="30rem" color="gray.500" fontSize="sm">
              Add cash, property, jewelry, debts or a custom asset. Investment holdings will appear automatically when they have an active position.
            </Text>
          </Stack>
        </Stack>
      </Flex>
    </Surface>
  );
}

export function NetWorthPanel() {
  useDocumentTitle("Net Worth");
  const { data, error, isLoading, isValidating, mutate } = useSWR<NetWorthOverview>(NET_WORTH_API_KEY, apiFetcher);
  const { data: account } = useSWR<AccountData>(ACCOUNT_API_KEY);
  const grouped = useMemo(() => groupedEntries(data?.entries ?? []), [data?.entries]);

  if (isLoading && !data) return <DataLoading label="Loading your net worth…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your net worth…" />;

  const hasEntries = data.entries.length > 0;

  return (
    <Stack gap={{ base: "6", md: "7" }}>
      <Stack gap="1">
        <Flex align="center" gap="3">
          <Text color="purple.600" fontSize="sm" fontWeight="750">BALANCE SHEET</Text>
          {isValidating ? <DataUpdating /> : null}
        </Flex>
        <Flex align={{ base: "flex-start", lg: "center" }} justify="space-between" gap="4" direction={{ base: "column", lg: "row" }}>
          <Flex align="center" gap="3">
            <Scale size={26} color="#7c3aed" aria-hidden="true" />
            <Heading as="h1" size={{ base: "2xl", md: "3xl" }} color="gray.900" letterSpacing="-0.045em">
              Net worth, kept honest
            </Heading>
          </Flex>
          <AddNetWorthItemDialog defaultCurrency={account?.currency ?? "EUR"} onSuccess={() => undefined} />
        </Flex>
        <Text color="gray.500">See what you own minus what you owe, with each currency kept separate and every estimate clearly labelled.</Text>
      </Stack>

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
        <Flex align="center" gap="2" color="gray.400" fontSize="xs">
          <WalletCards size={14} aria-hidden="true" /> Values stay in native currencies; no FX conversion is applied.
        </Flex>
      ) : null}
    </Stack>
  );
}
