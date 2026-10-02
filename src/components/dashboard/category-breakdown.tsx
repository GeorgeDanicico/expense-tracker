import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { categoryShares } from "@/lib/frontend/expense-analytics";
import type { Analytics } from "@/lib/types";
import { formatCurrency } from "@/lib/utils/currency";

export function CategoryBreakdown({
  items,
  currency,
}: {
  items: Analytics["categoryTotals"];
  currency: string;
}) {
  const categories = categoryShares(items);
  if (!categories.length)
    return <Text color="muted">No recorded expenses</Text>;
  return (
    <Stack
      as="ul"
      gap="3"
      listStyleType="none"
      aria-label="Spending by category"
    >
      {categories.map((item) => (
        <Stack as="li" key={item.category} gap="1">
          <Flex justify="space-between" gap="2" wrap="wrap">
            <Text fontSize="sm">{item.label}</Text>
            <Text fontSize="sm" fontWeight="500" overflowWrap="anywhere">
              {formatCurrency(item.total, currency)} · {item.share.toFixed(1)}%
            </Text>
          </Flex>
          <Box height="1.5" bg="canvas" borderRadius="full" aria-hidden="true">
            <Box
              height="full"
              width={`${item.share}%`}
              borderRadius="full"
              bg="clay"
            />
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}
