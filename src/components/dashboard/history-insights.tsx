import { SimpleGrid, Stack, Text } from "@chakra-ui/react";

import { AmountComparison } from "@/components/dashboard/amount-comparison";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import type { seriesInsights } from "@/lib/frontend/expense-analytics";
import { formatMonth } from "@/lib/calendar";

type Insights = ReturnType<typeof seriesInsights>;

/** Highest/lowest months and month-to-month changes for a multi-month range. */
export function HistoryInsights({
  insights,
  series,
  currency,
}: {
  insights: Insights;
  series: { total: number }[];
  currency: string;
}) {
  return (
    <>
      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="4" alignItems="start">
        {[
          { label: "Highest spending", items: insights.highest },
          { label: "Lowest spending", items: insights.lowest },
        ].map((group) => (
          <Card key={group.label}>
            <Card.Header title={group.label} />
            <Card.Body>
              <Stack gap="1.5">
                {group.items.map((item) => (
                  <Stack key={item.key} direction="row" justify="space-between" gap="2">
                    <Text textStyle="bodySm">{formatMonth(item.key)}</Text>
                    <Amount value={item.total} currency={currency} size="sm" />
                  </Stack>
                ))}
              </Stack>
            </Card.Body>
          </Card>
        ))}
      </SimpleGrid>
      <Card>
        <Card.Header title="Month to month" />
        <Card.Body>
          <Stack gap="0" divideY="1px" divideColor="border">
            {insights.changes.map((change, i) => (
              <Stack key={change.key} gap="0.5" py="2">
                <Text textStyle="caption">
                  {formatMonth(change.key)} compared with {formatMonth(change.previousKey)}
                </Text>
                <AmountComparison
                  current={series[i + 1].total}
                  previous={series[i].total}
                  currency={currency}
                />
              </Stack>
            ))}
          </Stack>
        </Card.Body>
      </Card>
    </>
  );
}
