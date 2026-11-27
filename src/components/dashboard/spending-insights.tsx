"use client";

import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react";
import { useState } from "react";
import useSWR from "swr";

import { HomeBlockPending, type BlockPending } from "@/components/dashboard/home-skeleton";
import { CategoryTile } from "@/components/expenses/category-visual";
import { Amount } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { DataError, DataLoading, DataRefresh } from "@/components/ui/data-state";
import { ListRow } from "@/components/ui/list-row";
import { SectionLink } from "@/components/ui/section-link";
import { ListSkeleton } from "@/components/ui/skeletons";
import { StatusBadge } from "@/components/ui/status-badge";
import { homeInsightsApiKey, insightsApiKey } from "@/lib/api/keys";
import { useServerFirstSWR } from "@/lib/api/server-fallback";
import { useAccount } from "@/hooks/use-account";
import { formatMonthName } from "@/lib/calendar";
import { INSIGHTS_PATH } from "@/lib/expenses/url-state";
import { ALL_MEMBERS } from "@/lib/family/viewing";
import type { ChangeKind, SpendingChange, SpendingChanges } from "@/lib/insights/changes";
import type { InsightsData } from "@/lib/insights/load-insights";
import type { RecurringPayment } from "@/lib/insights/recurring";
import { formatCurrency } from "@/lib/utils/currency";

/** The month's spending insights for yourself or one member; nothing for the whole family (the API refuses it). */
export function useSpendingInsights(month: string, member?: string | null) {
  return useSWR<InsightsData>(member === ALL_MEMBERS ? null : insightsApiKey(month, member), { keepPreviousData: false });
}

const KIND_LABELS: Record<ChangeKind, string> = { category: "Category", subtype: "Car", merchant: "Merchant" };

const signedPercent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value)}%`;

/** "vs October" for a finished month, "vs October, days 1–20" for the current one. */
export function comparedWith({ previousMonth, throughDay }: Pick<SpendingChanges, "previousMonth" | "throughDay">) {
  const name = formatMonthName(previousMonth);
  return throughDay === null ? `vs ${name}` : `vs ${name}, days 1–${throughDay}`;
}

/**
 * One change: what it's about, the amount now, and how it compares with the month before and the
 * average. `compact` (Home) keeps only the percent against the month before, so the line fits a phone.
 */
function ChangeRow({ item, previousMonth, currency, compact }: { item: SpendingChange; previousMonth: string; currency: string; compact: boolean }) {
  const previous = formatMonthName(previousMonth);
  const up = item.difference > 0;
  const meta = `${KIND_LABELS[item.kind]} · ${item.change === null ? `nothing in ${previous}` : `${signedPercent(item.change)} vs ${previous}`}`;
  const detail = compact
    ? null
    : [
        item.change === null ? null : `${previous}: ${formatCurrency(item.previous, currency)}`,
        item.averageChange === null || item.average === null ? null : `${signedPercent(item.averageChange)} vs ${formatCurrency(item.average, currency)} average`,
      ].filter(Boolean).join(" · ");
  return (
    <ListRow
      leading={<CategoryTile category={item.category} />}
      title={item.label}
      meta={meta}
      detail={detail || null}
      trailing={
        <Stack gap="0.5" align="flex-end">
          <Amount value={item.current} currency={currency} size="sm" />
          <StatusBadge tone={up ? "warning" : "positive"}>
            {`${up ? "+" : "−"}${formatCurrency(Math.abs(item.difference), currency)}`}
          </StatusBadge>
        </Stack>
      }
    />
  );
}

/** The notable changes as rows, the first `limit` of them. */
export function ChangeList({ changes, limit, currency, compact = false }: { changes: SpendingChanges; limit: number; currency: string; compact?: boolean }) {
  return (
    <Box as="ul" m="0" p="0">
      {changes.changes.slice(0, limit).map((item) => (
        <ChangeRow key={`${item.kind}:${item.key}`} item={item} previousMonth={changes.previousMonth} currency={currency} compact={compact} />
      ))}
    </Box>
  );
}

/** The whole month's change in one line: "1,250 lei more than October (+18%)". */
function TotalLine({ changes, currency }: { changes: SpendingChanges; currency: string }) {
  const { total, previousMonth } = changes;
  if (total.previous <= 0) return null;
  const name = formatMonthName(previousMonth);
  const text = total.difference === 0
    ? `The same as ${name}`
    : `${formatCurrency(Math.abs(total.difference), currency)} ${total.difference > 0 ? "more" : "less"} than ${name} (${signedPercent(total.change ?? 0)})`;
  return (
    <Text textStyle="bodySm">
      {text}
      {total.averageChange === null ? "" : `, ${signedPercent(total.averageChange)} vs your ${formatCurrency(total.average ?? 0, currency)} average`}.
    </Text>
  );
}

const CHANGES_SHOWN = 6;

/** Insights → Monthly: the month's notable changes by category, car subtype and merchant. */
export function SpendingChangesCard({ insights, currency }: { insights: ReturnType<typeof useSpendingInsights>; currency: string }) {
  const [all, setAll] = useState(false);
  const { data, error, isValidating, mutate } = insights;
  return (
    <Card>
      <Card.Header title="What changed" description={data ? comparedWith(data.changes) : undefined} />
      <Card.Body>
        {!data ? (
          error ? <DataError retry={() => void mutate()} /> : <DataLoading layout="section" label="Comparing your spending…" />
        ) : (
          <Stack gap="3">
            <DataRefresh error={error} updating={isValidating} retry={() => void mutate()} />
            <TotalLine changes={data.changes} currency={currency} />
            {data.changes.changes.length === 0 ? (
              <Text textStyle="bodySm" color="fg.muted">
                {data.changes.total.previous > 0 ? "Nothing stands out: every category and merchant is close to the month before." : "There's no earlier month to compare with yet."}
              </Text>
            ) : (
              <>
                <ChangeList changes={data.changes} limit={all ? Infinity : CHANGES_SHOWN} currency={currency} />
                {data.changes.changes.length > CHANGES_SHOWN ? (
                  <Flex>
                    <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
                      {all ? "Show fewer" : `Show all ${data.changes.changes.length}`}
                    </Button>
                  </Flex>
                ) : null}
              </>
            )}
          </Stack>
        )}
      </Card.Body>
    </Card>
  );
}

function RecurringRow({ payment, month, currency }: { payment: RecurringPayment; month: string; currency: string }) {
  const priceChange = payment.amount - payment.previousAmount;
  const changed = Math.abs(priceChange) >= 0.01;
  const meta = `${payment.months} months in a row${payment.charged ? "" : ` · not yet in ${formatMonthName(month)}`}`;
  return (
    <ListRow
      leading={<CategoryTile category={payment.category} />}
      title={payment.label}
      meta={meta}
      detail={changed ? `Was ${formatCurrency(payment.previousAmount, currency)}` : null}
      trailing={
        <Stack gap="0.5" align="flex-end">
          <Amount value={payment.amount} currency={currency} size="sm" />
          {changed ? (
            <StatusBadge tone={priceChange > 0 ? "warning" : "positive"}>
              {`${priceChange > 0 ? "+" : "−"}${formatCurrency(Math.abs(priceChange), currency)}`}
            </StatusBadge>
          ) : null}
        </Stack>
      }
    />
  );
}

/** Insights → Monthly: what looks like a subscription or a standing payment, and what they cost a month. */
export function RecurringPaymentsCard({ insights, currency }: { insights: ReturnType<typeof useSpendingInsights>; currency: string }) {
  const { data, error, mutate } = insights;
  return (
    <Card>
      <Card.Header
        title="Recurring payments"
        description={data?.recurring.payments.length ? `About ${formatCurrency(data.recurring.monthlyTotal, currency)} a month` : undefined}
      />
      <Card.Body>
        {!data ? (
          error ? <DataError retry={() => void mutate()} /> : <DataLoading layout="section" label="Looking for recurring payments…" />
        ) : data.recurring.payments.length === 0 ? (
          <Text textStyle="bodySm" color="fg.muted">
            No recurring payments found. A payment counts once the same merchant is charged about the same amount three months in a row.
          </Text>
        ) : (
          <Box as="ul" m="0" p="0">
            {data.recurring.payments.map((payment) => (
              <RecurringRow key={payment.key} payment={payment} month={data.month} currency={currency} />
            ))}
          </Box>
        )}
      </Card.Body>
    </Card>
  );
}

/** Where Home's block leads: this month on Insights → Monthly. */
const MONTHLY_INSIGHTS_HREF = `${INSIGHTS_PATH}?view=monthly`;

const homeChangesHeader = (description?: string) => (
  <Card.Header title="What changed" description={description} actions={<SectionLink href={MONTHLY_INSIGHTS_HREF}>Insights</SectionLink>} />
);

/** Home's "What changed" before its data: the skeleton or the error (PF6). */
export function HomeChangesPending(state: BlockPending) {
  return <HomeBlockPending {...state} header={homeChangesHeader()} label="Comparing your spending…" skeleton={<ListSkeleton rows={3} gap="0" />} errorMessage="This month's changes could not be loaded." />;
}

const HOME_CHANGES_SHOWN = 3;

/** Home: this month's three biggest changes so far, against the same days of last month. */
export function HomeChanges() {
  const { currency } = useAccount();
  const { data, error, mutate } = useServerFirstSWR<InsightsData>(homeInsightsApiKey());
  if (!data) return <HomeChangesPending error={error} retry={() => void mutate()} />;
  const { changes } = data;
  const more = changes.changes.length - HOME_CHANGES_SHOWN;
  return (
    <Card size="sm">
      {homeChangesHeader(comparedWith(changes))}
      <Card.Body>
        {changes.changes.length === 0 ? (
          <Text textStyle="caption">
            {changes.total.previous > 0 ? "Nothing stands out so far this month." : "There's no earlier month to compare with yet."}
          </Text>
        ) : (
          <Stack gap="1">
            <ChangeList changes={changes} limit={HOME_CHANGES_SHOWN} currency={currency} compact />
            {more > 0 ? <Text textStyle="caption">{`${more} more on Insights.`}</Text> : null}
          </Stack>
        )}
      </Card.Body>
    </Card>
  );
}
