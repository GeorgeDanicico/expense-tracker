"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { useAccount } from "@/hooks/use-account";
import { ApiError } from "@/lib/api/client";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { account: data, error, isLoading, mutate } = useAccount();

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
    return <DataLoading layout="screen" label="Opening your ledger…" />;
  }

  if (!data) {
    return <DataError retry={() => void mutate()} />;
  }

  return <AppShell email={data.email}>{children}</AppShell>;
}
