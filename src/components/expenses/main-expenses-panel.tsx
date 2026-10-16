"use client";

import { Box, Stack } from "@chakra-ui/react";
import useSWR from "swr";

import { ExpenseList } from "@/components/expenses/expense-list";
import { MonthToolbar } from "@/components/expenses/month-toolbar";
import { useViewing } from "@/hooks/use-viewing";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { Stat, StatGroup } from "@/components/ui/stat";
import { mainExpensesApiKey } from "@/lib/api/keys";
import type { ExpensesData } from "@/lib/expenses/types";
import { getBucharestMonth } from "@/lib/calendar";

/** The main ledger tab: month toolbar, month metrics and the expense list. */
export function MainExpensesPanel({ month, currency }: { month: string; currency: string }) {
  const viewing = useViewing();
  const { data, error, isValidating, mutate } = useSWR<ExpensesData>(
    mainExpensesApiKey(month, viewing.member),
    { keepPreviousData: false },
  );
  const matching = data?.month === month ? data : undefined;

  return (
    <Stack gap="4">
      <MonthToolbar
        month={month}
        maxMonth={getBucharestMonth()}
        href={(value) => viewing.hrefFor(`/expenses?month=${value}`)}
      />
      {!matching ? (
        error ? (
          <DataError retry={() => void mutate()} />
        ) : (
          <DataLoading label="Loading expenses…" />
        )
      ) : (
        <>
          <DataRefresh
            error={error}
            updating={isValidating}
            retry={() => void mutate()}
          />
          <Card>
            <Card.Body>
              <StatGroup>
                <Stat size="hero" label="Total" value={<Amount value={matching.total} currency={currency} size="hero" />} />
                <Stat size="sm" label="Transactions" value={String(matching.expenses.length)} />
                <Stat size="sm" label="Average expense" value={<Amount value={matching.average} currency={currency} />} />
              </StatGroup>
            </Card.Body>
          </Card>
          <Card overflow="hidden">
            <Card.Header title="All expenses" />
            <Box mt="3" borderTopWidth="1px" borderColor="border">
              <ExpenseList expenses={matching.expenses} currency={currency} allowDelete={!viewing.readOnly} />
            </Box>
          </Card>
        </>
      )}
    </Stack>
  );
}
