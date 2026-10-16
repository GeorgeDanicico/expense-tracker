"use client";

import { Stack } from "@chakra-ui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { HistoryDashboard } from "@/components/dashboard/history-dashboard";
import { MonthlyDashboard } from "@/components/dashboard/monthly-dashboard";
import { SummaryDashboard } from "@/components/dashboard/summary-dashboard";
import { PermissionGate } from "@/components/layout/permission-gate";
import { DataLoading } from "@/components/ui/data-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { dashboardApiKey } from "@/lib/api/keys";
import {
  dashboardHref,
  dashboardMonth,
  dashboardView,
  parseAnalyticsFilters,
  type DashboardView,
} from "@/lib/expenses/url-state";

const VIEWS = [
  { value: "summary", label: "Summary" },
  { value: "monthly", label: "Monthly" },
  { value: "history", label: "History" },
] as const;

function DashboardContent() {
  useDocumentTitle("Home");
  const router = useRouter();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams.toString());
  const view = dashboardView(params);
  const month = dashboardMonth(params);
  const filters = parseAnalyticsFilters(params);
  return (
    <Stack gap={{ base: "4", md: "5" }}>
      <PageHeader
        title="Home"
        actions={
          <SegmentedControl<DashboardView>
            aria-label="Home dashboards"
            name="dashboard-view"
            items={VIEWS}
            value={view}
            fullWidth={{ base: true, sm: false }}
            onValueChange={(value) =>
              router.push(dashboardHref(params, { view: value }), { scroll: false })
            }
          />
        }
      />
      {view === "summary" ? <SummaryDashboard params={params} /> : null}
      {view === "monthly" ? (
        <MonthlyDashboard key={month} month={month} params={params} />
      ) : null}
      {view === "history" ? (
        <HistoryDashboard key={dashboardApiKey(filters)} filters={filters} />
      ) : null}
    </Stack>
  );
}

export default function DashboardPage() {
  return (
    <PermissionGate module="expenses">
      <Suspense fallback={<DataLoading label="Loading Home…" />}>
        <DashboardContent />
      </Suspense>
    </PermissionGate>
  );
}
