"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR, { preload } from "swr";

import { AppShell } from "@/components/layout/app-shell";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { ApiError, apiFetcher } from "@/lib/api/client";
import { ACCOUNT_API_KEY, dashboardApiKey, expensesApiKey } from "@/lib/api/keys";
import type { AccountData } from "@/lib/types";
import { getCurrentMonth } from "@/lib/utils/dates";

const defaultDashboardKey = dashboardApiKey({
  period: "3m",
  granularity: "month",
  customDate: getCurrentMonth(),
});

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useSWR<AccountData>(ACCOUNT_API_KEY);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      router.replace("/login");
      return;
    }

    if (data) {
      router.prefetch("/dashboard");
      router.prefetch("/expenses");
      router.prefetch("/settings");
      void preload(defaultDashboardKey, apiFetcher);
      void preload(expensesApiKey(getCurrentMonth()), apiFetcher);
    }
  }, [data, error, router]);

  if (isLoading || (error instanceof ApiError && error.status === 401)) {
    return <DataLoading label="Opening your ledger…" />;
  }

  if (error || !data) {
    return <DataError retry={() => void mutate()} />;
  }

  return <AppShell email={data.email}>{children}</AppShell>;
}
