import { Flex, Text } from "@chakra-ui/react";
import type { ComponentProps } from "react";

import { Amount } from "@/components/ui/amount";
import type { CurrencyTotals } from "@/lib/expenses/types";

/**
 * Family figures in each currency side by side, such as "1,240 RON · 85 EUR". Different currencies
 * are never added together. An empty list shows zero in `fallbackCurrency`.
 */
export function CurrencyAmounts({
  totals,
  field = "total",
  fallbackCurrency,
  size = "md",
}: {
  totals: CurrencyTotals[];
  field?: "total" | "average" | "largest";
  fallbackCurrency: string;
  size?: ComponentProps<typeof Amount>["size"];
}) {
  const entries = totals.length ? totals : [{ currency: fallbackCurrency, total: 0, average: 0, largest: 0, count: 0 }];
  return (
    <Flex as="span" wrap="wrap" columnGap="2" rowGap="0.5" align="baseline">
      {entries.map((entry, index) => (
        <Flex as="span" key={entry.currency} columnGap="2" align="baseline">
          {index > 0 ? (
            <Text as="span" color="fg.muted" aria-hidden="true">
              ·
            </Text>
          ) : null}
          <Amount value={entry[field]} currency={entry.currency} size={size} />
        </Flex>
      ))}
    </Flex>
  );
}
