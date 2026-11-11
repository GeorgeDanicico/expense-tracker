"use client";

import { Box, Flex, Stack, Text } from "@chakra-ui/react";
import { Inbox } from "lucide-react";

import { HomeBlockPending, MonthBodySkeleton, type BlockPending } from "@/components/dashboard/home-skeleton";
import { CategoryTile } from "@/components/expenses/category-visual";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON } from "@/components/ui/icon";
import { ListRow } from "@/components/ui/list-row";
import { SectionLink } from "@/components/ui/section-link";
import { ListSkeleton } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { transition } from "@/components/ui/theme/motion";
import { useAccount } from "@/hooks/use-account";
import { homeDashboardApiKey } from "@/lib/api/keys";
import { useServerFirstSWR } from "@/lib/api/server-fallback";
import { formatMonthName, getBucharestMonth } from "@/lib/calendar";
import { expenseClassificationLabel } from "@/lib/expenses/categories";
import type { DashboardData } from "@/lib/expenses/types";
import { monthSoFar, relativeDay } from "@/lib/home/today";
import { INSIGHTS_PATH } from "@/lib/expenses/url-state";
import { formatCurrency } from "@/lib/utils/currency";

/**
 * Home's two spending blocks read the dashboard Summary reads (the same SWR key, so Insights opens
 * with it already loaded and a new expense shows in both at once: `useExpenseWrites`).
 */
function useHomeDashboard() {
  return useServerFirstSWR<DashboardData>(homeDashboardApiKey());
}

/** The month card before its data: its title and link, then the skeleton or the error (PF6). */
export function MonthCardPending(state: BlockPending) {
  return (
    <HomeBlockPending
      {...state}
      header={<Card.Header title={`Spent in ${formatMonthName(getBucharestMonth())}`} actions={<SectionLink href={INSIGHTS_PATH}>Insights</SectionLink>} />}
      label="Loading this month…"
      skeleton={<MonthBodySkeleton />}
      errorMessage="This month's spending could not be loaded."
    />
  );
}

/** This month's total against last month's, with a meter of how much of last month's it is. */
export function MonthCard() {
  const { currency } = useAccount();
  const { data, error, mutate } = useHomeDashboard();
  if (!data) return <MonthCardPending error={error} retry={() => void mutate()} />;
  const { previousMonth, previousTotal, share, over } = monthSoFar(data);
  const previous = formatMonthName(previousMonth);
  return (
    <Card size="sm">
      <Card.Header title={`Spent in ${formatMonthName(data.currentMonth)}`} actions={<SectionLink href={INSIGHTS_PATH}>Insights</SectionLink>} />
      <Card.Body>
        <Stack gap="2">
          <Flex align="baseline" gap="2.5" wrap="wrap">
            <Amount value={data.currentTotal} currency={currency} size="hero" />
            {previousTotal > 0 ? (
              <StatusBadge tone={over > 0 ? "warning" : "neutral"}>
                {over > 0 ? `${formatCurrency(over, currency)} over ${previous}` : `${Math.round((data.currentTotal / previousTotal) * 100)}% of ${previous}`}
              </StatusBadge>
            ) : null}
          </Flex>
          {previousTotal > 0 ? (
            <Box height="2" borderRadius="pill" bg="bg.muted" overflow="hidden" role="img" aria-label={`${formatCurrency(data.currentTotal, currency)} of ${previous}'s ${formatCurrency(previousTotal, currency)}`}>
              <Box height="full" bg={over > 0 ? "fg.warning" : "chart.bar"} borderRadius="pill" transformOrigin="left" transform={`scaleX(${share})`} transition={transition("transform", "slow")} />
            </Box>
          ) : (
            <Text textStyle="caption">{data.currentCount === 0 ? "Nothing spent yet this month." : `Nothing was spent in ${previous}.`}</Text>
          )}
        </Stack>
      </Card.Body>
    </Card>
  );
}

const recentHeader = <Card.Header title="Recent expenses" actions={<SectionLink href="/expenses">Expenses</SectionLink>} />;

/** The recent expenses before their data: the skeleton or the error (PF6). */
export function RecentExpensesPending(state: BlockPending) {
  return <HomeBlockPending {...state} header={recentHeader} label="Loading your expenses…" skeleton={<ListSkeleton rows={5} gap="0" />} errorMessage="Your expenses could not be loaded." />;
}

/** The last five expenses of the month, newest first. */
export function RecentExpenses({ now }: { now: Date }) {
  const { currency } = useAccount();
  const { data, error, mutate } = useHomeDashboard();
  if (!data) return <RecentExpensesPending error={error} retry={() => void mutate()} />;
  const expenses = data.currentExpenses.slice(0, 5);
  return (
    <Card size="sm">
      {recentHeader}
      <Card.Body>
        {expenses.length === 0 ? (
          <EmptyState size="sm" titleAs="p" icon={<Inbox size={ICON.nav} aria-hidden="true" />} title="No expenses yet this month" description="Tap + to add one." />
        ) : (
          <Box as="ul" m="0" p="0">
            {expenses.map((expense) => (
              <ListRow
                key={expense.id}
                leading={<CategoryTile category={expense.category} />}
                title={expense.description}
                meta={`${relativeDay(expense.expenseDate, now)} · ${expenseClassificationLabel(expense.category, expense.subtype)}`}
                trailing={<Amount value={expense.amount} currency={currency} size="sm" />}
              />
            ))}
          </Box>
        )}
      </Card.Body>
    </Card>
  );
}
