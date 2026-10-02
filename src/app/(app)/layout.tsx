"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { AppShell } from "@/components/layout/app-shell";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { ApiError } from "@/lib/api/client";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import type { AccountData } from "@/lib/types";

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
      router.prefetch("/investments");
      router.prefetch("/net-worth");
      router.prefetch("/settings");
    }
  }, [data, error, router]);

  if ((isLoading && !data) || (error instanceof ApiError && error.status === 401)) {
    return <DataLoading label="Opening your ledger…" />;
  }

  if (!data) {
    return <DataError retry={() => void mutate()} />;
  }

  return <AppShell email={data.email}>{children}</AppShell>;
}
