"use client";

import { Stack, Tabs } from "@chakra-ui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SummaryDashboard } from "@/components/dashboard/summary-dashboard";
import { MonthlyDashboard } from "@/components/dashboard/monthly-dashboard";
import { HistoryDashboard } from "@/components/dashboard/history-dashboard";
import { DataLoading } from "@/components/ui/data-state";
import { PageHeader } from "@/components/ui/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";
import {
  dashboardHref,
  dashboardMonth,
  dashboardView,
} from "@/lib/frontend/dashboard-state";
import { parseAnalyticsFilters } from "@/lib/utils/analytics";
import { dashboardApiKey } from "@/lib/api/keys";

function DashboardContent() {
  useDocumentTitle("Home");
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  const view = dashboardView(params);
  const month = dashboardMonth(params);
  const filters = parseAnalyticsFilters(params);
  return (
    <Stack gap="4">
      <PageHeader title="Home" />
      <Tabs.Root
        value={view}
        onValueChange={({ value }) =>
          router.push(dashboardHref(params, { view: value }), { scroll: false })
        }
        lazyMount
        unmountOnExit
      >
        <Tabs.List
          aria-label="Home dashboards"
          display="flex"
          width="full"
          borderColor="border"
          mb="4"
        >
          {(
            [
              ["summary", "Summary"],
              ["monthly", "Monthly"],
              ["history", "History"],
            ] as const
          ).map(([value, label]) => (
            <Tabs.Trigger
              key={value}
              value={value}
              flex="1"
              minW="0"
              minH="11"
              px="1"
              whiteSpace="normal"
              overflowWrap="anywhere"
              textAlign="center"
              justifyContent="center"
              fontSize="sm"
              color="muted"
              _selected={{ color: "accent", borderColor: "accent" }}
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="summary" p="0">
          {view === "summary" ? <SummaryDashboard params={params} /> : null}
        </Tabs.Content>
        <Tabs.Content value="monthly" p="0">
          {view === "monthly" ? (
            <MonthlyDashboard key={month} month={month} params={params} />
          ) : null}
        </Tabs.Content>
        <Tabs.Content value="history" p="0">
          {view === "history" ? (
            <HistoryDashboard
              key={dashboardApiKey(filters)}
              filters={filters}
            />
          ) : null}
        </Tabs.Content>
      </Tabs.Root>
    </Stack>
  );
}
export default function DashboardPage() {
  return (
    <Suspense fallback={<DataLoading label="Loading Home…" />}>
      <DashboardContent />
    </Suspense>
  );
}
