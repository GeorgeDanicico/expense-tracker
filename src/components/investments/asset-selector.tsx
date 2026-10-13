"use client";

import { Box, chakra, Flex, Stack, Text } from "@chakra-ui/react";

import { InvestmentValue } from "@/components/investments/investment-value";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { investmentAssetKey } from "@/lib/investments/identity";
import type { InvestmentOverviewAsset } from "@/lib/investments/types";

/** Selectable list of a broker's assets; the selected row opens its detail below. */
export function AssetSelector({
  accountId,
  assets,
  selectedKey,
  detailId,
  onSelect,
}: {
  accountId: string;
  assets: InvestmentOverviewAsset[];
  selectedKey: string | null;
  detailId: string;
  onSelect: (asset: InvestmentOverviewAsset) => void;
}) {
  return (
    <Stack gap="2">
      <SectionHeader as="h3" title="Assets" meta="Select an asset to view orders" />
      <Box as="ul" m="0" p="0" listStyleType="none" borderWidth="1px" borderColor="border" borderRadius="control" overflow="hidden" divideY="1px" divideColor="border">
        {assets.map((asset) => {
          const key = investmentAssetKey(accountId, asset.instrument, asset.currency);
          const selected = selectedKey === key;

          return (
            <li key={`${asset.instrument}-${asset.currency}`}>
              <chakra.button
                type="button"
                data-investment-asset-key={key}
                aria-pressed={selected}
                aria-controls={selected ? detailId : undefined}
                aria-label={`View ${asset.displayName} (${asset.instrument})`}
                onClick={() => onSelect(asset)}
                display="flex"
                width="full"
                position="relative"
                px="3"
                py="2.5"
                gap="3"
                alignItems={{ base: "flex-start", sm: "center" }}
                flexDirection={{ base: "column", sm: "row" }}
                justifyContent="space-between"
                textAlign="start"
                cursor="pointer"
                bg={selected ? "bg.selected" : "bg.surface"}
                transition="background 120ms ease"
                _hover={{ bg: selected ? "bg.selected" : "bg.subtle" }}
                _focusVisible={{ outline: "2px solid", outlineColor: "fg.accent", outlineOffset: "-2px" }}
                _before={selected ? {
                  content: '""', position: "absolute", insetStart: "0", top: "0", bottom: "0", width: "2px", bg: "fg.accent",
                } : undefined}
              >
                <Stack minW="0" gap="0">
                  <Text textStyle="bodySm" fontWeight="medium" truncate>{asset.displayName}</Text>
                  <Text textStyle="caption" truncate>
                    {asset.instrument} · {asset.quantity} units · {asset.currency}
                  </Text>
                </Stack>
                <Stack minW="0" gap="0.5" align={{ base: "flex-start", sm: "flex-end" }}>
                  <Text textStyle="amountSm" overflowWrap="anywhere" textAlign={{ sm: "end" }}>
                    <InvestmentValue
                      currentValue={asset.currentValue}
                      unrealizedGain={asset.unrealizedGain}
                      currency={asset.currency}
                    />
                  </Text>
                  <Flex align="center" gap="1.5">
                    <Text textStyle="caption">
                      {asset.priceStatus === "current" ? "Current value" : asset.priceStatus === "currency_mismatch" ? "Currency mismatch" : "No quote"}
                    </Text>
                    {asset.priceSource ? (
                      <StatusBadge tone="brand">{asset.priceSource === "ZF" ? "ZF" : "Yahoo Finance"}</StatusBadge>
                    ) : null}
                  </Flex>
                </Stack>
              </chakra.button>
            </li>
          );
        })}
      </Box>
    </Stack>
  );
}
