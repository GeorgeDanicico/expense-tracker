import { Flex, Stack, Text } from "@chakra-ui/react";

import { ChartBar } from "@/components/dashboard/chart-bar";
import { categoryShares } from "@/lib/frontend/expense-analytics";
import type { Analytics } from "@/lib/types";
import { formatCurrency } from "@/lib/utils/currency";

export function CategoryBreakdown({
  items,
  currency,
  ariaLabel = "Spending by category",
}: {
  items: (Analytics["categoryTotals"][number] | {
    groupKey: string;
    label: string;
    total: number;
  })[];
  currency: string;
  ariaLabel?: string;
}) {
  const categories = categoryShares(items);
  if (!categories.length)
    return <Text textStyle="bodySm" color="fg.muted">No recorded expenses</Text>;
  return (
    <Stack as="ul" gap="2.5" listStyleType="none" aria-label={ariaLabel}>
      {categories.map((item) => (
        <Stack as="li" key={"groupKey" in item ? item.groupKey : item.category} gap="1">
          <Flex justify="space-between" align="baseline" gap="2" wrap="wrap">
            <Text textStyle="bodySm">{item.label}</Text>
            <Text textStyle="amountSm" overflowWrap="anywhere">
              {formatCurrency(item.total, currency)}
              <Text as="span" textStyle="caption"> · {item.share.toFixed(1)}%</Text>
            </Text>
          </Flex>
          <ChartBar share={item.share} />
        </Stack>
      ))}
    </Stack>
  );
}
