"use client";

import { Badge, Box, Flex, Heading, SimpleGrid, Stack, Text } from "@chakra-ui/react";

import { AssetDetail } from "@/components/investments/asset-detail";
import { AssetSelector } from "@/components/investments/asset-selector";
import { Surface } from "@/components/ui/surface";
import { investmentAssetKey, investmentDetailId } from "@/lib/investments/identity";
import type { InvestmentsOverview } from "@/lib/investments/types";
import { INVESTMENT_BROKER_LABELS } from "@/lib/investments/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";

export function BrokerSection({
  broker,
  selectedKey,
  onSelect,
  onClose,
}: {
  broker: InvestmentsOverview["brokers"][number];
  selectedKey: string | null;
  onSelect: (asset: InvestmentsOverview["brokers"][number]["assets"][number]) => void;
  onClose: () => void;
}) {
  const detailId = investmentDetailId(broker.accountId);
  const selectedAsset = broker.assets.find(
    (asset) => selectedKey === investmentAssetKey(broker.accountId, asset.instrument, asset.currency),
  );

  return (
    <Surface p={{ base: "5", md: "6" }}>
      <Stack gap="6">
        <Flex align={{ base: "flex-start", sm: "center" }} justify="space-between" gap="4">
          <Stack gap="1">
            <Text color="purple.600" fontSize="xs" fontWeight="800" letterSpacing="0.1em">
              BROKER ACCOUNT
            </Text>
            <Heading as="h2" size={{ base: "lg", md: "xl" }} letterSpacing="-0.03em">
              {INVESTMENT_BROKER_LABELS[broker.brokerId]}
            </Heading>
            <Text color="gray.500" fontSize="sm">
              {broker.assets.length} {broker.assets.length === 1 ? "asset" : "assets"} tracked in native currency.
            </Text>
          </Stack>
          <Badge colorPalette="purple" variant="subtle" borderRadius="full" px="3" py="1.5">
            Totals by currency
          </Badge>
        </Flex>

        <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap="3">
          {broker.totalsByCurrency.map((subtotal) => (
            <Box key={subtotal.currency} p="4" borderRadius="2xl" bg="gray.50">
              <Text color="gray.500" fontSize="xs" fontWeight="750" letterSpacing="0.06em">
                {subtotal.currency} TOTAL
              </Text>
              <Text mt="1" color="gray.900" fontSize={{ base: "lg", md: "xl" }} fontWeight="800" letterSpacing="-0.03em">
                {subtotal.currentValue === null
                  ? "Value unavailable"
                  : formatInvestmentAmount(subtotal.currentValue, subtotal.currency)}
              </Text>
              <Flex align="center" gap="2" mt="1.5">
                <Text color="gray.500" fontSize="xs">
                  Cost basis {formatInvestmentAmount(subtotal.remainingCost, subtotal.currency)}
                </Text>
                {subtotal.currentValue !== null ? (
                  <Badge colorPalette="purple" variant="subtle" borderRadius="full" fontSize="2xs">
                    Mock price
                  </Badge>
                ) : null}
              </Flex>
            </Box>
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
            detailId={detailId}
            onClose={onClose}
          />
        ) : null}
      </Stack>
    </Surface>
  );
}
