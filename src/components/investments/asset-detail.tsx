"use client";

import { Alert, Badge, Box, Button, Flex, Heading, SimpleGrid, Skeleton, Stack, Text } from "@chakra-ui/react";
import { RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import useSWR from "swr";

import { AddOrderDialog } from "@/components/investments/add-order-dialog";
import { InvestmentValue } from "@/components/investments/investment-value";
import { TransactionList } from "@/components/investments/transaction-list";
import { DataRefresh } from "@/components/ui/data-state";
import { apiFetcher } from "@/lib/api/client";
import { investmentTransactionsApiKey } from "@/lib/api/keys";
import type {
  InvestmentBrokerId,
  InvestmentOverviewAsset,
  InvestmentTransactionsResponse,
} from "@/lib/investments/types";
import { getInvestmentGainPresentation } from "@/lib/investments/presentation";
import { formatInvestmentAmount } from "@/lib/utils/currency";
import { formatDateTime } from "@/lib/utils/dates";

function DetailMetric({
  label,
  value,
  helper,
  valueColor = "fg",
}: {
  label: string;
  value: ReactNode;
  helper?: string;
  valueColor?: string;
}) {
  return (
    <Box>
      <Text color="muted" fontSize="xs" fontWeight="600" letterSpacing="0.05em">
        {label}
      </Text>
      <Text mt="1" color={valueColor} fontSize="1.5rem" fontWeight="600" overflowWrap="anywhere" letterSpacing="-0.03em">
        {value}
      </Text>
      {helper ? <Text mt="1" color="muted" fontSize="xs">{helper}</Text> : null}
    </Box>
  );
}

function quoteStatus(asset: InvestmentOverviewAsset) {
  if (asset.priceStatus === "current" && asset.priceAsOf) {
    const source = asset.priceSource === "ZF" ? "ZF" : "Yahoo Finance";
    return `${source} · as of ${formatDateTime(asset.priceAsOf)}`;
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
      <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap="3">
        {["one", "two", "three", "four"].map((item) => <Skeleton key={item} height="6rem" borderRadius="2xl" />)}
      </SimpleGrid>
      <Skeleton height="11rem" borderRadius="2xl" />
    </Stack>
  );
}

export function AssetDetail({
  asset,
  accountId,
  brokerId,
  detailId,
  onClose,
}: {
  asset: InvestmentOverviewAsset;
  accountId: string;
  brokerId: InvestmentBrokerId;
  detailId: string;
  onClose: () => void;
}) {
  const key = investmentTransactionsApiKey({ accountId, instrument: asset.instrument, currency: asset.currency });
  const { data, error, isLoading, isValidating, mutate } = useSWR<InvestmentTransactionsResponse>(key, apiFetcher);
  const unrealized = getInvestmentGainPresentation(asset.unrealizedGain, asset.currency);
  const realized = getInvestmentGainPresentation(asset.realizedGain, asset.currency);

  return (
    <Box
      id={detailId}
      tabIndex={-1}
      borderTopWidth="1px"
      borderColor="border"
      pt="5"
      aria-labelledby={`${detailId}-title`}
      aria-live="polite"
    >
      <Flex align="flex-start" justify="space-between" gap="4" mb="5" wrap="wrap">
        <Stack minW="0" gap="1">
          <Flex align="center" gap="2" wrap="wrap">
            <Heading as="h3" id={`${detailId}-title`} size={{ base: "lg", md: "xl" }} letterSpacing="-0.03em" truncate>
              {asset.displayName}
            </Heading>
            {asset.priceSource ? (
              <Badge colorPalette="purple" variant="subtle" borderRadius="full" px="2.5" py="1">
                {asset.priceSource === "ZF" ? "ZF" : "Yahoo Finance"}
              </Badge>
            ) : null}
          </Flex>
          <Text color="muted" fontSize="sm" fontWeight="600">
            {asset.instrument} · {asset.currency} · {quoteStatus(asset)}
          </Text>
        </Stack>
        <Flex align="center" gap="2" flexShrink="0" ml="auto">
          <AddOrderDialog accountId={accountId} brokerId={brokerId} asset={asset} />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            borderRadius="lg"
            minH="11"
            aria-label={`Close ${asset.instrument} details`}
            onClick={onClose}
          >
            <X size={17} aria-hidden="true" />
          </Button>
        </Flex>
      </Flex>

      <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} gap="3">
        <DetailMetric label="Quantity" value={`${asset.quantity} units`} />
        <DetailMetric label="Average acquisition" value={formatInvestmentAmount(asset.averageCost, asset.currency)} helper="Per unit" />
        <DetailMetric label="Current price" value={formatInvestmentAmount(asset.currentPrice, asset.currency)} />
        <DetailMetric label="Remaining cost" value={formatInvestmentAmount(asset.remainingCost, asset.currency)} />
        <DetailMetric
          label="Current value"
          value={
            <InvestmentValue
              currentValue={asset.currentValue}
              unrealizedGain={asset.unrealizedGain}
              currency={asset.currency}
            />
          }

        />
        <DetailMetric label="Unrealized" value={unrealized.value} valueColor={unrealized.label === "Gain" ? "positive" : unrealized.label === "Loss" ? "error" : "muted"} helper={unrealized.label} />
        <DetailMetric label="Realized" value={realized.value} valueColor={realized.label === "Gain" ? "positive" : realized.label === "Loss" ? "error" : "muted"} helper={realized.label} />
      </SimpleGrid>

      <Box mt="5" overflow="hidden" borderWidth="1px" borderColor="border" borderRadius="2xl">
        <Flex align="center" justify="space-between" gap="3" px={{ base: "4", md: "5" }} py="4" borderBottomWidth="1px" borderColor="canvas">
          <Stack gap="1">
            <Heading as="h4" size="md" letterSpacing="-0.02em">Transaction history</Heading>
            <Text color="muted" fontSize="sm">Newest orders first · values in {asset.currency}</Text>
          </Stack>
          {data ? <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} /> : null}
        </Flex>

        {isLoading && !data ? (
          <>
            <Text className="sr-only" role="status">Loading transaction history…</Text>
            <DetailLoading />
          </>
        ) : null}
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
        {data ? (
          <TransactionList
            accountId={accountId}
            instrument={asset.instrument}
            transactions={data.transactions}
            currency={asset.currency}
            onDeleted={() => {
              if (data.transactions.length === 1) onClose();
            }}
          />
        ) : null}
      </Box>
    </Box>
  );
}
