"use client";

import { Flex, SimpleGrid, Stack, Text } from "@chakra-ui/react";

import { AssetDetail } from "@/components/investments/asset-detail";
import { AssetSelector } from "@/components/investments/asset-selector";
import { InvestmentValue } from "@/components/investments/investment-value";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { investmentAssetKey, investmentDetailId } from "@/lib/investments/identity";
import type { InvestmentsOverview } from "@/lib/investments/types";
import { INVESTMENT_BROKER_LABELS } from "@/lib/investments/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";

export function BrokerSection({
  broker,
  selectedKey,
  onSelect,
  onClose,
  member,
}: {
  broker: InvestmentsOverview["brokers"][number];
  selectedKey: string | null;
  onSelect: (asset: InvestmentsOverview["brokers"][number]["assets"][number]) => void;
  onClose: () => void;
  /** Whose order history the detail reads, when it isn't the page's own viewed member (the family view). */
  member?: string;
}) {
  const detailId = investmentDetailId(broker.accountId);
  const headingId = `investment-broker-${broker.accountId}`;
  const selectedAsset = broker.assets.find(
    (asset) => selectedKey === investmentAssetKey(broker.accountId, asset.instrument, asset.currency),
  );

  return (
    <Card as="section" aria-labelledby={headingId}>
      <Card.Header
        id={headingId}
        title={INVESTMENT_BROKER_LABELS[broker.brokerId]}
        description={`${broker.assets.length} ${broker.assets.length === 1 ? "asset" : "assets"} tracked in native currency.`}
        actions={<StatusBadge>Totals by currency</StatusBadge>}
      />
      <Card.Body>
        <Stack gap="5">
          <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap="4">
            {broker.totalsByCurrency.map((subtotal) => (
              <Stack key={subtotal.currency} gap="0.5" minW="0">
                <Text textStyle="label" color="fg.muted">Total ({subtotal.currency})</Text>
                <Text textStyle="amountLg">
                  <InvestmentValue
                    currentValue={subtotal.currentValue}
                    unrealizedGain={subtotal.unrealizedGain}
                    currency={subtotal.currency}
                  />
                </Text>
                <Flex align="center" gap="2" wrap="wrap">
                  <Text textStyle="caption">
                    Cost basis {formatInvestmentAmount(subtotal.remainingCost, subtotal.currency)}
                  </Text>
                  {subtotal.currentValue !== null ? <StatusBadge tone="brand">Latest price</StatusBadge> : null}
                </Flex>
              </Stack>
            ))}
          </SimpleGrid>

          <AssetSelector
            accountId={broker.accountId}
            assets={broker.assets}
            selectedKey={selectedKey}
            detailId={detailId}
            onSelect={onSelect}
          />

          {selectedAsset ? (
            <AssetDetail
              asset={selectedAsset}
              accountId={broker.accountId}
              brokerId={broker.brokerId}
              detailId={detailId}
              onClose={onClose}
              member={member}
            />
          ) : null}
        </Stack>
      </Card.Body>
    </Card>
  );
}
