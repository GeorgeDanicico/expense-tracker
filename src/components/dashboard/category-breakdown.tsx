import { Box, Flex, Stack, Text } from "@chakra-ui/react";

import type { Analytics } from "@/lib/data/expenses";
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
    return <Text color="gray.500">No category data for this period.</Text>;
  }

  return (
    <Stack gap="4">
      {items.slice(0, 6).map((item) => (
        <Stack key={item.category} gap="1">
          <Flex justify="space-between" gap="4">
            <Text fontSize="sm" fontWeight="medium">{item.label}</Text>
            <Text fontSize="sm" color="gray.600">{formatCurrency(item.total, currency)}</Text>
          </Flex>
          <Box height="2" bg="gray.100">
            <Box height="full" width={`${(item.total / max) * 100}%`} bg="blue.600" />
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}
