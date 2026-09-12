"use client";

import { Alert, Badge, Box, Button, Flex, Heading, SimpleGrid, Skeleton, Stack, Text } from "@chakra-ui/react";
import { RefreshCw, X } from "lucide-react";
import useSWR from "swr";

import { TransactionList } from "@/components/investments/transaction-list";
import { DataUpdating } from "@/components/ui/data-state";
import { apiFetcher } from "@/lib/api/client";
import { investmentTransactionsApiKey } from "@/lib/api/keys";
import type { InvestmentOverviewAsset, InvestmentTransactionsResponse } from "@/lib/investments/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";
import { formatDateTime } from "@/lib/utils/dates";

function DetailMetric({
  label,
  value,
  helper,
  valueColor = "gray.900",
}: {
  label: string;
  value: string;
  helper?: string;
  valueColor?: string;
}) {
  return (
    <Box p="4" borderRadius="2xl" bg="gray.50">
      <Text color="gray.500" fontSize="xs" fontWeight="750" letterSpacing="0.05em">
        {label}
      </Text>
      <Text mt="1" color={valueColor} fontSize={{ base: "lg", md: "xl" }} fontWeight="800" letterSpacing="-0.03em">
        {value}
      </Text>
      {helper ? <Text mt="1" color="gray.500" fontSize="xs">{helper}</Text> : null}
    </Box>
  );
}

function gainPresentation(value: string | null, currency: string) {
  if (value === null) return { value: "Unavailable", color: "gray.500", label: "No quote" };

  const numericValue = Number(value);
  if (numericValue > 0) return { value: `+${formatInvestmentAmount(value, currency)}`, color: "green.700", label: "Gain" };
  if (numericValue < 0) return { value: formatInvestmentAmount(value, currency), color: "red.700", label: "Loss" };
  return { value: formatInvestmentAmount(value, currency), color: "gray.700", label: "No change" };
}

function quoteStatus(asset: InvestmentOverviewAsset) {
  if (asset.priceStatus === "current" && asset.priceAsOf) {
    return `Mock price · as of ${formatDateTime(asset.priceAsOf)}`;
  }
  if (asset.priceStatus === "currency_mismatch") {
    return "Currency mismatch · valuation withheld";
  }
  return "Price unavailable · transaction data is still available";
}

function DetailLoading() {
  return (
    <Stack gap="4" p={{ base: "4", md: "5" }} aria-busy="true" aria-live="polite">
      <Skeleton height="5" width="12rem" />
      <SimpleGrid columns={{ base: 2, md: 4 }} gap="3">
        {["one", "two", "three", "four"].map((item) => <Skeleton key={item} height="6rem" borderRadius="2xl" />)}
      </SimpleGrid>
      <Skeleton height="11rem" borderRadius="2xl" />
    </Stack>
  );
}

export function AssetDetail({
  asset,
  accountId,
  detailId,
  onClose,
}: {
  asset: InvestmentOverviewAsset;
  accountId: string;
  detailId: string;
  onClose: () => void;
}) {
  const key = investmentTransactionsApiKey({ accountId, instrument: asset.instrument, currency: asset.currency });
  const { data, error, isLoading, isValidating, mutate } = useSWR<InvestmentTransactionsResponse>(key, apiFetcher);
  const unrealized = gainPresentation(asset.unrealizedGain, asset.currency);
  const realized = gainPresentation(asset.realizedGain, asset.currency);

  return (
    <Box
      id={detailId}
      tabIndex={-1}
      borderTopWidth="1px"
      borderColor="gray.200"
      pt="5"
      aria-labelledby={`${detailId}-title`}
      aria-live="polite"
    >
      <Flex align="flex-start" justify="space-between" gap="4" mb="5">
        <Stack minW="0" gap="1">
          <Flex align="center" gap="2" wrap="wrap">
            <Heading as="h3" id={`${detailId}-title`} size={{ base: "lg", md: "xl" }} letterSpacing="-0.03em" truncate>
              {asset.displayName}
            </Heading>
            {asset.priceSource === "mock" ? (
              <Badge colorPalette="purple" variant="subtle" borderRadius="full" px="2.5" py="1">
                Mock price
              </Badge>
            ) : null}
          </Flex>
          <Text color="gray.500" fontSize="sm" fontWeight="650">
            {asset.instrument} · {asset.currency} · {quoteStatus(asset)}
          </Text>
        </Stack>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          flexShrink="0"
          borderRadius="lg"
          aria-label={`Close ${asset.instrument} details`}
          onClick={onClose}
        >
          <X size={17} aria-hidden="true" />
        </Button>
      </Flex>

      <SimpleGrid columns={{ base: 2, md: 4 }} gap="3">
        <DetailMetric label="QUANTITY" value={`${asset.quantity} units`} helper={asset.currency} />
        <DetailMetric label="AVERAGE ACQUISITION" value={formatInvestmentAmount(asset.averageCost, asset.currency)} helper="Per unit" />
        <DetailMetric label="CURRENT PRICE" value={formatInvestmentAmount(asset.currentPrice, asset.currency)} helper={asset.priceStatus === "current" ? "Mock price" : quoteStatus(asset)} />
        <DetailMetric label="REMAINING COST" value={formatInvestmentAmount(asset.remainingCost, asset.currency)} helper="Native currency" />
        <DetailMetric label="CURRENT VALUE" value={formatInvestmentAmount(asset.currentValue, asset.currency)} helper={asset.priceStatus === "current" ? "Mock price" : quoteStatus(asset)} />
        <DetailMetric label="UNREALIZED" value={unrealized.value} valueColor={unrealized.color} helper={unrealized.label} />
        <DetailMetric label="REALIZED" value={realized.value} valueColor={realized.color} helper={realized.label} />
      </SimpleGrid>

      <Box mt="5" overflow="hidden" borderWidth="1px" borderColor="gray.200" borderRadius="2xl">
        <Flex align="center" justify="space-between" gap="3" px={{ base: "4", md: "5" }} py="4" borderBottomWidth="1px" borderColor="gray.100">
          <Stack gap="1">
            <Heading as="h4" size="md" letterSpacing="-0.02em">Transaction history</Heading>
            <Text color="gray.500" fontSize="sm">Newest orders first · values in {asset.currency}</Text>
          </Stack>
          {isValidating && data ? <DataUpdating /> : null}
        </Flex>

        {isLoading && !data ? <DetailLoading /> : null}
        {error && !data ? (
          <Alert.Root status="error" m="4" borderRadius="xl">
            <Alert.Indicator />
            <Stack flex="1" gap="2">
              <Alert.Description>{error instanceof Error ? error.message : "Unable to load transaction history."}</Alert.Description>
              <Button type="button" alignSelf="flex-start" size="sm" variant="outline" borderRadius="lg" onClick={() => void mutate()}>
                <RefreshCw size={15} aria-hidden="true" /> Try again
              </Button>
            </Stack>
          </Alert.Root>
        ) : null}
        {data ? <TransactionList transactions={data.transactions} currency={asset.currency} /> : null}
      </Box>
    </Box>
  );
}
