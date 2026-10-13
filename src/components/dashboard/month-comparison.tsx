import { Flex, Stack, Text } from "@chakra-ui/react";

import { AmountComparison } from "@/components/dashboard/amount-comparison";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { categoryComparisons, type monthAnalytics } from "@/lib/frontend/expense-analytics";
import { formatMonth } from "@/lib/utils/dates";

type MonthAnalytics = ReturnType<typeof monthAnalytics>;

/** Comparison of a completed month with the month before it, overall and per category. */
export function MonthComparison({
  previousMonth,
  completed,
  current,
  before,
  currency,
  previousError,
  previousValidating,
  retryPrevious,
}: {
  previousMonth: string;
  completed: boolean;
  current: MonthAnalytics;
  before: MonthAnalytics | null;
  currency: string;
  previousError: unknown;
  previousValidating: boolean;
  retryPrevious: () => void;
}) {
  return (
    <Card>
      <Card.Header title={`Compared with ${formatMonth(previousMonth)}`} />
      <Card.Body>
        {!completed ? (
          <Text textStyle="bodySm" color="fg.muted">
            Comparison available after this month ends.
          </Text>
        ) : !before ? (
          previousError ? (
            <DataError retry={retryPrevious} />
          ) : (
            <DataLoading layout="section" label="Loading comparison…" />
          )
        ) : (
          <Stack gap="3">
            <DataRefresh error={previousError} updating={previousValidating} retry={retryPrevious} />
            <AmountComparison current={current.total} previous={before.total} currency={currency} />
            <Stack as="ul" listStyleType="none" gap="0" divideY="1px" divideColor="border">
              {categoryComparisons(current.categories, before.categories).map((item) => (
                <Flex as="li" key={item.category} gap="2" py="2" justify="space-between" wrap="wrap">
                  <Text textStyle="bodySm">{item.label}</Text>
                  <AmountComparison
                    current={current.categories.find((c) => c.category === item.category)?.total ?? 0}
                    previous={before.categories.find((c) => c.category === item.category)?.total ?? 0}
                    currency={currency}
                  />
                </Flex>
              ))}
            </Stack>
          </Stack>
        )}
      </Card.Body>
    </Card>
  );
}
