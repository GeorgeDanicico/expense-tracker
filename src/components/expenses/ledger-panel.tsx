"use client";

import { Box, Flex, Grid, Stack, Text } from "@chakra-ui/react";
import { useState, type ReactNode } from "react";

import { CategoryBreakdown } from "@/components/dashboard/category-breakdown";
import { CurrencyAmounts } from "@/components/expenses/currency-totals";
import { ExpenseFilters } from "@/components/expenses/expense-filters";
import { ExpenseList } from "@/components/expenses/expense-list";
import type { ExpenseRowActions } from "@/components/expenses/expense-rows";
import { MemberName } from "@/components/family/member-swatch";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { DataError, DataRefresh } from "@/components/ui/data-state";
import { LedgerSkeleton } from "@/components/ui/skeletons";
import { LEDGER_COLUMNS, PAGE_SPACING } from "@/components/ui/theme/layout";
import { useViewing } from "@/hooks/use-viewing";
import { mainExpensesApiKey } from "@/lib/api/keys";
import { useServerFirstSWR } from "@/lib/api/server-fallback";
import { formatMonth, getBucharestToday, shiftMonth } from "@/lib/calendar";
import { monthAnalytics } from "@/lib/expenses/analytics";
import { groupByCurrency } from "@/lib/expenses/family";
import { filterExpenses, NO_LEDGER_FILTER } from "@/lib/expenses/tab-filters";
import { monthChange } from "@/lib/expenses/month-change";
import { summarizeExpenses } from "@/lib/expenses/summary";
import type { ExpensesData, FamilyExpensesData, ListedExpense } from "@/lib/expenses/types";

type Ledger = ExpensesData | FamilyExpensesData;

/** The family view's side card: each member's month in their own currency, the biggest first. */
function ByMember({ expenses }: { expenses: readonly ListedExpense[] }) {
  const members = new Map<string, { name: string; currency: string; total: number }>();
  for (const expense of expenses) {
    if (!expense.memberId) continue;
    const member = members.get(expense.memberId) ?? { name: expense.memberName ?? "", currency: expense.currency ?? "", total: 0 };
    members.set(expense.memberId, { ...member, total: member.total + expense.amount });
  }
  return (
    <Stack as="ul" gap="2.5" m="0" p="0" listStyleType="none">
      {[...members].sort((a, b) => b[1].total - a[1].total).map(([memberId, member]) => (
        <Flex as="li" key={memberId} justify="space-between" align="baseline" gap="2">
          <Text as="span" textStyle="bodySm">
            <MemberName memberId={memberId} name={member.name} />
          </Text>
          <Amount value={member.total} currency={member.currency} size="sm" />
        </Flex>
      ))}
    </Stack>
  );
}

const isFamilyLedger = (ledger: Ledger): ledger is FamilyExpensesData => "totals" in ledger;

/**
 * The month's ledger, the caller's, a member's or the whole family's (`?member=all`): one line with
 * the total, the count and the change from the month before, then the rows grouped by day. Desktop
 * adds where the month went ("By category") beside the list; the charts are Insights'. `filtersOpen`
 * shows the search and category filter (the Filters chip). `controls` (the month, member and tab
 * chips) head the list's column.
 */
export function LedgerPanel({
  month,
  currency,
  filtersOpen,
  actions,
  controls,
}: {
  month: string;
  currency: string;
  filtersOpen: boolean;
  actions?: ExpenseRowActions;
  controls: ReactNode;
}) {
  const viewing = useViewing();
  const [filter, setFilter] = useState(NO_LEDGER_FILTER);
  const { data, error, isValidating, mutate } = useServerFirstSWR<Ledger>(mainExpensesApiKey(month, viewing.member), { keepPreviousData: false });
  // The month before, for the comparison; it also has ‹ ready. The family view mixes currencies, so it has none.
  const previousMonth = shiftMonth(month, -1);
  const { data: previous } = useServerFirstSWR<ExpensesData>(viewing.family ? null : mainExpensesApiKey(previousMonth, viewing.member));
  const ledger = data?.month === month ? data : undefined;

  if (!ledger) {
    return error ? (
      <Stack gap="3">
        {controls}
        <DataError retry={() => void mutate()} />
      </Stack>
    ) : <LedgerSkeleton controls={controls} slowKey={mainExpensesApiKey(month, viewing.member)} />;
  }

  // Filtered once: the rows (deleted ones still there, to collapse), and what the totals count.
  const filtering = filtersOpen && (filter.query.trim() !== "" || filter.category !== "all");
  const matching: ListedExpense[] = filtering ? filterExpenses(ledger.expenses, filter) : ledger.expenses;
  const isShown = (expense: ListedExpense) => !actions?.hidden.has(expense.id);
  const shown = matching.filter(isShown);
  const visibleCount = ledger.expenses.filter(isShown).length;
  const totals = isFamilyLedger(ledger)
    ? groupByCurrency(shown.map((expense) => ({ currency: expense.currency ?? currency, total: expense.amount, count: 1, largest: expense.amount })))
    : null;
  const { total } = summarizeExpenses(shown);
  const comparable = !totals && !filtering;
  const change = comparable && previous?.month === previousMonth
    ? monthChange(month, shown, previous.expenses, getBucharestToday())
    : null;
  // The comparison arrives with the month before, a moment after the rows, and on a phone it wraps the
  // line: keep room for it until it's here, so the list doesn't drop when it lands (PF3).
  const waitingForChange = comparable && previous?.month !== previousMonth;

  return (
    <Grid templateColumns={LEDGER_COLUMNS} gap={PAGE_SPACING.columnGap} alignItems="start">
      <Stack gap="3" minW="0">
        {controls}
        {filtersOpen ? (
          <ExpenseFilters
            query={filter.query}
            onQueryChange={(query) => setFilter({ ...filter, query })}
            category={filter.category}
            onCategoryChange={(category) => setFilter({ ...filter, category })}
            shown={shown.length}
            total={visibleCount}
          />
        ) : null}
        <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />
        <Text as="div" textStyle="bodySm" color="fg.muted" display="flex" flexWrap="wrap" columnGap="1.5" alignItems="baseline" minH={waitingForChange ? { base: "2.25rem", md: "1.125rem" } : undefined}>
          <Text as="span" fontWeight="semibold" color="fg">
            {totals ? <CurrencyAmounts totals={totals} fallbackCurrency={currency} size="sm" /> : <Amount value={total} currency={currency} size="sm" />}
          </Text>
          <span>· {shown.length === 1 ? "1 expense" : `${shown.length} expenses`}</span>
          {change ? <span>· {change}</span> : null}
        </Text>
        <Card>
          <Card.Body>
            <ExpenseList
              expenses={matching}
              currency={currency}
              actions={actions}
              filtered={filtering}
              emptyHint={actions ? `Nothing in ${formatMonth(month)} yet. Tap + to add an expense.` : null}
            />
          </Card.Body>
        </Card>
      </Stack>
      <Box display={{ base: "none", lg: "block" }}>
        <Card>
          <Card.Header title={totals ? "By member" : "By category"} description={formatMonth(month)} />
          <Card.Body>
            {totals ? <ByMember expenses={shown} /> : <CategoryBreakdown items={monthAnalytics(shown, month).categories} currency={currency} />}
          </Card.Body>
        </Card>
      </Box>
    </Grid>
  );
}
