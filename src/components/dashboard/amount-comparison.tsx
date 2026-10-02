import { Text } from "@chakra-ui/react";
import { formatCurrency } from "@/lib/utils/currency";
import { compareAmounts } from "@/lib/frontend/expense-analytics";

export function AmountComparison({
  current,
  previous,
  currency,
}: {
  current: number;
  previous: number;
  currency: string;
}) {
  const { difference, percentage } = compareAmounts(current, previous);
  return (
    <Text fontSize="sm" overflowWrap="anywhere">
      {formatCurrency(Math.abs(difference), currency)}{" "}
      {difference > 0 ? "more" : difference < 0 ? "less" : "difference"}
      {percentage === null
        ? " · No percentage baseline"
        : ` · ${Math.abs(percentage).toFixed(1)}% ${percentage > 0 ? "increase" : percentage < 0 ? "decrease" : "change"}`}
    </Text>
  );
}
