"use client";

import { Alert, Flex, Heading, Stack, Text } from "@chakra-ui/react";
import { Inbox, TriangleAlert } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { BrokerSection } from "@/components/investments/broker-section";
import { AddInvestmentDialog } from "@/components/investments/add-investment-dialog";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { PageHeader } from "@/components/ui/page-header";
import { Surface } from "@/components/ui/surface";
import { apiFetcher } from "@/lib/api/client";
import { INVESTMENTS_API_KEY } from "@/lib/api/keys";
import { investmentAssetKey } from "@/lib/investments/identity";
import type { InvestmentOverviewAsset, InvestmentsOverview } from "@/lib/investments/types";
import { useDocumentTitle } from "@/hooks/use-document-title";

function EmptyInvestments() {
  return (
    <Surface p="4">
      <Flex minH="12rem" align="center" justify="center" textAlign="center">
        <Stack align="center" gap="4">
          <Flex width="8" height="8" align="center" justify="center" color="muted">
            <Inbox size={25} aria-hidden="true" />
          </Flex>
          <Stack align="center" gap="1.5">
            <Heading as="h2" size="lg" letterSpacing="-0.025em">No investments yet</Heading>
            <Text maxW="28rem" color="muted" fontSize="sm">
              Your investment accounts will appear here once their first executed order is recorded.
            </Text>
          </Stack>
        </Stack>
      </Flex>
    </Surface>
  );
}

function CalculationIssues({ overview }: { overview: InvestmentsOverview }) {
  if (!overview.calculationIssues?.length) return null;

  return (
    <Alert.Root status="warning" borderRadius="2xl">
      <Alert.Indicator />
      <Stack gap="1">
        <Text fontWeight="600">Some investment history needs attention</Text>
        {overview.calculationIssues.map((issue) => (
          <Alert.Description key={`${issue.transactionId}-${issue.code}`}>
            {issue.instrument ? `${issue.instrument}: ` : ""}{issue.message}
          </Alert.Description>
        ))}
      </Stack>
    </Alert.Root>
  );
}

export function InvestmentsPanel() {
  useDocumentTitle("Investments");
  const { data, error, isLoading, isValidating, mutate } = useSWR<InvestmentsOverview>(INVESTMENTS_API_KEY, apiFetcher);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (isLoading && !data) return <DataLoading label="Loading your investments…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your investments…" />;

  function selectAsset(accountId: string, asset: InvestmentOverviewAsset) {
    const nextKey = investmentAssetKey(accountId, asset.instrument, asset.currency);
    setSelectedKey((current) => current === nextKey ? null : nextKey);
  }

  function closeSelectedAsset() {
    const keyToRestore = selectedKey;
    setSelectedKey(null);

    if (!keyToRestore) return;
    requestAnimationFrame(() => {
      const assetButton = [...document.querySelectorAll<HTMLButtonElement>("[data-investment-asset-key]")]
        .find((button) => button.dataset.investmentAssetKey === keyToRestore);
      assetButton?.focus();
    });
  }

  return (
    <Stack gap={{ base: "6", md: "7" }}>
      <PageHeader title="Investments"><AddInvestmentDialog /></PageHeader>
      <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />

      <CalculationIssues overview={data} />

      {!data.brokers.length ? <EmptyInvestments /> : (
        <Stack gap={{ base: "5", md: "6" }}>
          {data.brokers.map((broker) => (
            <BrokerSection
              key={broker.accountId}
              broker={broker}
              selectedKey={selectedKey}
              onSelect={(asset) => selectAsset(broker.accountId, asset)}
              onClose={closeSelectedAsset}
            />
          ))}
        </Stack>
      )}

      {data.brokers.length > 0 && !data.calculationIssues?.length ? (
        <Flex align="center" gap="2" color="muted" fontSize="xs">
          <TriangleAlert size={14} aria-hidden="true" />
          Values are shown separately by currency; no currencies are combined.
        </Flex>
      ) : null}
    </Stack>
  );
}
