"use client";

import { Badge, Button, Flex, Stack, Text } from "@chakra-ui/react";

import { InvestmentValue } from "@/components/investments/investment-value";
import type { InvestmentOverviewAsset } from "@/lib/investments/types";
import { investmentAssetKey } from "@/lib/investments/identity";

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
    <Stack gap="3">
      <Flex align="center" justify="space-between" gap="3">
        <Text color="muted" fontSize="xs" fontWeight="600" letterSpacing="0.08em">
          ASSETS
        </Text>
        <Text color="muted" fontSize="xs">
          Select an asset to view orders
        </Text>
      </Flex>
      <Flex
        gap="3"
        direction={{ base: "column", md: "row" }}
        overflowX={{ base: "visible", md: "auto" }}
        pb={{ base: "0", md: "1" }}
      >
        {assets.map((asset) => {
          const selected = selectedKey === investmentAssetKey(accountId, asset.instrument, asset.currency);

          return (
            <Button
              key={`${asset.instrument}-${asset.currency}`}
              type="button"
              data-investment-asset-key={investmentAssetKey(accountId, asset.instrument, asset.currency)}
              variant="outline"
              flex={{ base: "1 1 auto", md: "0 0 18rem" }}
              minW={{ base: "0", md: "18rem" }}
              minH="16"
              height="auto"
              px="4"
              py="3.5"
              justifyContent="stretch"
              textAlign="start"
              whiteSpace="normal"
              borderRadius="2xl"
              borderColor={selected ? "accent" : "border"}
              bg={selected ? "selected" : "white"}
              aria-pressed={selected}
              aria-controls={selected ? detailId : undefined}
              aria-label={`View ${asset.displayName} (${asset.instrument})`}
              onClick={() => onSelect(asset)}
              _hover={{
                borderColor: selected ? "accent" : "clay",
                bg: selected ? "selected" : "selected",
              }}
            >
              <Flex width="full" align={{base:"flex-start",sm:"center"}} direction={{base:"column",sm:"row"}} justify="space-between" gap="2">
                <Stack minW="0" gap="1">
                  <Text color="fg" fontSize="sm" fontWeight="600" truncate>
                    {asset.displayName}
                  </Text>
                  <Text color="muted" fontSize="xs" fontWeight="600" truncate>
                    {asset.instrument} · {asset.quantity} units · {asset.currency}
                  </Text>
                </Stack>
                <Stack minW="0" align={{base:"flex-start",sm:"flex-end"}} gap="1">
                  <Text color="fg" fontSize="sm" fontWeight="600" overflowWrap="anywhere">
                    <InvestmentValue
                      currentValue={asset.currentValue}
                      unrealizedGain={asset.unrealizedGain}
                      currency={asset.currency}
                    />
                  </Text>
                  <Flex align="center" gap="1.5">
                    <Text color="muted" fontSize="xs" overflowWrap="anywhere">
                      {asset.priceStatus === "current" ? "Current value" : asset.priceStatus === "currency_mismatch" ? "Currency mismatch" : "No quote"}
                    </Text>
                    {asset.priceSource ? (
                      <Badge colorPalette="purple" variant="subtle" borderRadius="full" fontSize="2xs">
                        {asset.priceSource === "ZF" ? "ZF" : "Yahoo Finance"}
                      </Badge>
                    ) : null}
                  </Flex>
                </Stack>
              </Flex>
            </Button>
          );
        })}
      </Flex>
    </Stack>
  );
}
