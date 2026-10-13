"use client";

import { Box, Flex, Stack } from "@chakra-ui/react";
import { Inbox, TriangleAlert } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { AddInvestmentDialog } from "@/components/investments/add-investment-dialog";
import { BrokerSection } from "@/components/investments/broker-section";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiFetcher } from "@/lib/api/client";
import { INVESTMENTS_API_KEY } from "@/lib/api/keys";
import { investmentAssetKey } from "@/lib/investments/identity";
import type { InvestmentOverviewAsset, InvestmentsOverview } from "@/lib/investments/types";

function CalculationIssues({ overview }: { overview: InvestmentsOverview }) {
  if (!overview.calculationIssues?.length) return null;

  return (
    <InlineAlert status="warning" title="Some investment history needs attention">
      {overview.calculationIssues.map((issue) => (
        <Box as="span" display="block" key={`${issue.transactionId}-${issue.code}`}>
          {issue.instrument ? `${issue.instrument}: ` : ""}{issue.message}
        </Box>
      ))}
    </InlineAlert>
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
    <Stack gap={{ base: "4", md: "5" }}>
      <PageHeader title="Investments" actions={<AddInvestmentDialog />} />
      <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />

      <CalculationIssues overview={data} />

      {!data.brokers.length ? (
        <Card>
          <EmptyState
            icon={<Inbox />}
            title="No investments yet"
            description="Your investment accounts will appear here once their first executed order is recorded."
          />
        </Card>
      ) : (
        <Stack gap="4">
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
        <Flex align="center" gap="2" textStyle="caption">
          <TriangleAlert size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Values are shown separately by currency; no currencies are combined.
        </Flex>
      ) : null}
    </Stack>
  );
}
