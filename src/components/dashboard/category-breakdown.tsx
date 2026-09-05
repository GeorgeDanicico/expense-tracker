import { Box, Flex, Stack, Text } from "@chakra-ui/react";

import { CategoryVisual } from "@/components/expenses/category-visual";
import type { Analytics } from "@/lib/types";
import { formatCurrency } from "@/lib/utils/currency";

export function CategoryBreakdown({
  items,
  currency,
}: {
  items: Analytics["categoryTotals"];
  currency: string;
}) {
  const max = items[0]?.total ?? 1;

  if (!items.length) {
    return (
      <Flex minH="17rem" align="center" justify="center" textAlign="center">
        <Stack gap="1">
          <Text fontWeight="700">No category activity</Text>
          <Text color="gray.500" fontSize="sm">Expenses will be grouped here.</Text>
        </Stack>
      </Flex>
    );
  }

  return (
    <Stack gap="4.5">
      {items.slice(0, 6).map((item) => (
        <Flex key={item.category} align="center" gap="3">
          <CategoryVisual category={item.category} size="9" />
          <Stack flex="1" minW="0" gap="1.5">
            <Flex justify="space-between" gap="4">
              <Text fontSize="sm" fontWeight="650" truncate>{item.label}</Text>
              <Text color="gray.700" fontSize="sm" fontWeight="700" whiteSpace="nowrap">
                {formatCurrency(item.total, currency)}
              </Text>
            </Flex>
            <Box height="1.5" overflow="hidden" borderRadius="full" bg="gray.100">
              <Box
                height="full"
                width={`${(item.total / max) * 100}%`}
                minW="1.5"
                borderRadius="full"
                bg="purple.500"
              />
            </Box>
          </Stack>
        </Flex>
      ))}
    </Stack>
  );
}
