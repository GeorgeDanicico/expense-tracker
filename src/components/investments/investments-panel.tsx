"use client";

import { Box, Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Inbox, TriangleAlert } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { AddInvestmentDialog } from "@/components/investments/add-investment-dialog";
import { BrokerSection } from "@/components/investments/broker-section";
import { MemberName } from "@/components/family/member-swatch";
import { ViewingControls } from "@/components/family/viewing-picker";
import { WriteOnly } from "@/components/family/write-only";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InvestmentValue } from "@/components/investments/investment-value";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useViewing } from "@/hooks/use-viewing";
import { apiFetcher } from "@/lib/api/client";
import { investmentsApiKey } from "@/lib/api/keys";
import { familyInvestmentTotals } from "@/lib/investments/family-totals";
import { investmentAssetKey } from "@/lib/investments/identity";
import type { FamilyInvestmentsOverview, InvestmentOverviewAsset, InvestmentsOverview } from "@/lib/investments/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";

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

function SingleInvestmentsPanel() {
  useDocumentTitle("Investments");
  const { member, readOnly, name } = useViewing();
  const { data, error, isLoading, isValidating, mutate } = useSWR<InvestmentsOverview>(investmentsApiKey(member), apiFetcher);
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
      <PageHeader title="Investments" actions={<WriteOnly><AddInvestmentDialog /></WriteOnly>} />
      <ViewingControls noun="investments" family />
      <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />

      <CalculationIssues overview={data} />

      {!data.brokers.length ? (
        <Card>
          <EmptyState
            icon={<Inbox />}
            title="No investments yet"
            description={
              readOnly
                ? `${name}’s investment accounts will appear here once their first executed order is recorded.`
                : "Your investment accounts will appear here once their first executed order is recorded."
            }
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

/** The whole family's total per currency, above the member sections. */
function FamilyTotals({ data }: { data: FamilyInvestmentsOverview }) {
  const totals = familyInvestmentTotals(data);
  if (!totals.length) return null;

  return (
    <Card>
      <Card.Header title="Family total" />
      <Card.Body>
        <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap="4">
          {totals.map((total) => (
            <Stack key={total.currency} gap="0.5" minW="0">
              <Text textStyle="label" color="fg.muted">Total ({total.currency})</Text>
              <Text textStyle="amountLg">
                <InvestmentValue currentValue={total.currentValue} unrealizedGain={total.unrealizedGain} currency={total.currency} />
              </Text>
              <Text textStyle="caption">Cost basis {formatInvestmentAmount(total.remainingCost, total.currency)}</Text>
            </Stack>
          ))}
        </SimpleGrid>
      </Card.Body>
    </Card>
  );
}

/** The family view: one section per member, using the same broker sections, read-only. */
function FamilyInvestmentsPanel() {
  useDocumentTitle("Investments");
  const { data, error, isLoading, isValidating, mutate } = useSWR<FamilyInvestmentsOverview>(investmentsApiKey("all"), apiFetcher);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  if (isLoading && !data) return <DataLoading label="Loading the family's investments…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading the family's investments…" />;

  function toggle(accountId: string, asset: InvestmentOverviewAsset) {
    const nextKey = investmentAssetKey(accountId, asset.instrument, asset.currency);
    setSelectedKey((current) => current === nextKey ? null : nextKey);
  }

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <PageHeader title="Investments" />
      <ViewingControls noun="investments" family />
      <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />

      <FamilyTotals data={data} />

      {data.members.map((entry) => (
        <Stack key={entry.memberId} as="section" gap="3" aria-labelledby={`family-investments-${entry.memberId}`}>
          <SectionHeader as="h2" id={`family-investments-${entry.memberId}`} title={<MemberName memberId={entry.memberId} name={entry.name} />} />
          <CalculationIssues overview={entry.overview} />
          {!entry.overview.brokers.length ? (
            <Card>
              <EmptyState icon={<Inbox />} title="No investments yet" description={`${entry.name} has no recorded orders.`} />
            </Card>
          ) : (
            entry.overview.brokers.map((broker) => (
              <BrokerSection
                key={broker.accountId}
                broker={broker}
                member={entry.memberId}
                selectedKey={selectedKey}
                onSelect={(asset) => toggle(broker.accountId, asset)}
                onClose={() => setSelectedKey(null)}
              />
            ))
          )}
        </Stack>
      ))}

      <Flex align="center" gap="2" textStyle="caption">
        <TriangleAlert size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
        Totals are added per currency; no currencies are combined. A total with no price for some holding shows cost basis only.
      </Flex>
    </Stack>
  );
}

export function InvestmentsPanel() {
  const { family } = useViewing();
  return family ? <FamilyInvestmentsPanel /> : <SingleInvestmentsPanel />;
}
