"use client";

import { Stack } from "@chakra-ui/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { HistoryDashboard } from "@/components/dashboard/history-dashboard";
import { MonthlyDashboard } from "@/components/dashboard/monthly-dashboard";
import { SummaryDashboard } from "@/components/dashboard/summary-dashboard";
import { ViewingControls } from "@/components/family/viewing-picker";
import { PermissionGate } from "@/components/layout/permission-gate";
import { DataLoading } from "@/components/ui/data-state";
import { PageHeader } from "@/components/ui/page-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useViewing } from "@/hooks/use-viewing";
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
  const viewing = useViewing();
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
      <ViewingControls noun="expenses" />
      {!viewing.ready ? <DataLoading label="Loading Home…" /> : null}
      {viewing.ready && view === "summary" ? <SummaryDashboard params={params} /> : null}
      {viewing.ready && view === "monthly" ? (
        <MonthlyDashboard key={month} month={month} params={params} />
      ) : null}
      {viewing.ready && view === "history" ? (
        <HistoryDashboard key={dashboardApiKey(filters, viewing.member)} filters={filters} />
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
