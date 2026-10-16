"use client";

import { Box, Button, Flex, SimpleGrid, Skeleton, Stack, Text } from "@chakra-ui/react";
import { RefreshCw, X } from "lucide-react";
import useSWR from "swr";

import { WriteOnly } from "@/components/family/write-only";
import { AddOrderDialog } from "@/components/investments/add-order-dialog";
import { InvestmentValue } from "@/components/investments/investment-value";
import { TransactionList } from "@/components/investments/transaction-list";
import { DataRefresh } from "@/components/ui/data-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SectionHeader } from "@/components/ui/section-header";
import { Stat } from "@/components/ui/stat";
import { StatusBadge } from "@/components/ui/status-badge";
import { useViewing } from "@/hooks/use-viewing";
import { apiFetcher } from "@/lib/api/client";
import { investmentTransactionsApiKey } from "@/lib/api/keys";
import type {
  InvestmentBrokerId,
  InvestmentOverviewAsset,
  InvestmentTransactionsResponse,
} from "@/lib/investments/types";
import { getInvestmentGainPresentation, type InvestmentGainPresentation } from "@/lib/investments/presentation";
import { formatInvestmentAmount } from "@/lib/utils/currency";
import { formatDateTime } from "@/lib/calendar";

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

function gainStatTone(gain: InvestmentGainPresentation) {
  if (gain.label === "Gain") return "positive";
  if (gain.label === "Loss") return "negative";
  return "muted";
}

function DetailLoading() {
  return (
    <Stack gap="3" p="4" aria-busy="true" aria-live="polite">
      <Skeleton height="4" width="12rem" />
      {["one", "two", "three"].map((item) => <Skeleton key={item} height="9" borderRadius="control" />)}
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
  const { member } = useViewing();
  const key = investmentTransactionsApiKey({ accountId, instrument: asset.instrument, currency: asset.currency, member });
  const { data, error, isLoading, isValidating, mutate } = useSWR<InvestmentTransactionsResponse>(key, apiFetcher);
  const unrealized = getInvestmentGainPresentation(asset.unrealizedGain, asset.currency);
  const realized = getInvestmentGainPresentation(asset.realizedGain, asset.currency);

  return (
    <Box
      id={detailId}
      tabIndex={-1}
      borderTopWidth="1px"
      borderColor="border"
      pt="4"
      aria-labelledby={`${detailId}-title`}
      aria-live="polite"
      _focusVisible={{ outline: "none" }}
    >
      <Flex align="flex-start" justify="space-between" gap="3" mb="4" wrap="wrap">
        <Stack minW="0" gap="0.5">
          <Flex align="center" gap="2" wrap="wrap">
            <Text as="h3" id={`${detailId}-title`} textStyle="dialogTitle" truncate>
              {asset.displayName}
            </Text>
            {asset.priceSource ? (
              <StatusBadge tone="brand">{asset.priceSource === "ZF" ? "ZF" : "Yahoo Finance"}</StatusBadge>
            ) : null}
          </Flex>
          <Text textStyle="caption">
            {asset.instrument} · {asset.currency} · {quoteStatus(asset)}
          </Text>
        </Stack>
        <Flex align="center" gap="1" flexShrink="0" ms="auto">
          <WriteOnly>
            <AddOrderDialog accountId={accountId} brokerId={brokerId} asset={asset} />
          </WriteOnly>
          <IconButton aria-label={`Close ${asset.instrument} details`} size="xs" tooltip onClick={onClose}>
            <X size={ICON.sm} strokeWidth={ICON_STROKE} />
          </IconButton>
        </Flex>
      </Flex>

      <SimpleGrid columns={{ base: 2, md: 4 }} columnGap="4" rowGap="4">
        <Stat size="sm" label="Quantity" value={`${asset.quantity} units`} />
        <Stat size="sm" label="Average acquisition" value={formatInvestmentAmount(asset.averageCost, asset.currency)} helper="Per unit" />
        <Stat size="sm" label="Current price" value={formatInvestmentAmount(asset.currentPrice, asset.currency)} />
        <Stat size="sm" label="Remaining cost" value={formatInvestmentAmount(asset.remainingCost, asset.currency)} />
        <Stat
          size="sm"
          label="Current value"
          value={<InvestmentValue currentValue={asset.currentValue} unrealizedGain={asset.unrealizedGain} currency={asset.currency} />}
        />
        <Stat size="sm" label="Unrealized" value={unrealized.value} tone={gainStatTone(unrealized)} helper={unrealized.label} />
        <Stat size="sm" label="Realized" value={realized.value} tone={gainStatTone(realized)} helper={realized.label} />
      </SimpleGrid>

      <Box mt="5" overflow="hidden" borderWidth="1px" borderColor="border" borderRadius="control">
        <Box px="4" py="3" borderBottomWidth="1px" borderColor="border">
          <SectionHeader
            as="h4"
            title="Transaction history"
            meta={`Newest orders first · values in ${asset.currency}`}
            actions={data ? <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} /> : null}
          />
        </Box>

        {isLoading && !data ? (
          <>
            <Text className="sr-only" role="status">Loading transaction history…</Text>
            <DetailLoading />
          </>
        ) : null}
        {error && !data ? (
          <Box p="3">
            <InlineAlert
              status="error"
              action={
                <Button type="button" size="xs" variant="outline" onClick={() => void mutate()}>
                  <RefreshCw size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Try again
                </Button>
              }
            >
              {error instanceof Error ? error.message : "Unable to load transaction history."}
            </InlineAlert>
          </Box>
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
