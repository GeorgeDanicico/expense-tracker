"use client";

import { Badge, Button, Flex, Stack, Text } from "@chakra-ui/react";

import type { InvestmentOverviewAsset } from "@/lib/investments/types";
import { investmentAssetKey } from "@/lib/investments/identity";
import { formatInvestmentAmount } from "@/lib/utils/currency";

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
        <Text color="gray.500" fontSize="xs" fontWeight="750" letterSpacing="0.08em">
          ASSETS
        </Text>
        <Text color="gray.400" fontSize="xs">
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
              borderColor={selected ? "purple.400" : "gray.200"}
              bg={selected ? "purple.50" : "white"}
              boxShadow={selected ? "0 0 0 3px rgb(124 58 237 / 10%)" : "none"}
              aria-pressed={selected}
              aria-controls={selected ? detailId : undefined}
              aria-label={`View ${asset.displayName} (${asset.instrument})`}
              onClick={() => onSelect(asset)}
              _hover={{
                borderColor: selected ? "purple.400" : "purple.300",
                bg: selected ? "purple.50" : "purple.50/50",
              }}
            >
              <Flex width="full" align="center" justify="space-between" gap="4">
                <Stack minW="0" gap="1">
                  <Text color="gray.900" fontSize="sm" fontWeight="800" truncate>
                    {asset.displayName}
                  </Text>
                  <Text color="gray.500" fontSize="xs" fontWeight="650" truncate>
                    {asset.instrument} · {asset.quantity} units · {asset.currency}
                  </Text>
                </Stack>
                <Stack flexShrink="0" align="flex-end" gap="1">
                  <Text color="gray.900" fontSize="sm" fontWeight="800" whiteSpace="nowrap">
                    {asset.currentValue === null
                      ? "Value unavailable"
                      : formatInvestmentAmount(asset.currentValue, asset.currency)}
                  </Text>
                  <Flex align="center" gap="1.5">
                    <Text color="gray.400" fontSize="xs" whiteSpace="nowrap">
                      {asset.priceStatus === "current" ? "Current value" : asset.priceStatus === "currency_mismatch" ? "Currency mismatch" : "No quote"}
                    </Text>
                    {asset.priceSource === "mock" ? (
                      <Badge colorPalette="purple" variant="subtle" borderRadius="full" fontSize="2xs">
                        Mock price
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
