"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { DataError, DataLoading } from "@/components/ui/data-state";
import { ApiError } from "@/lib/api/client";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import type { AccountData } from "@/lib/types";

export default function HomePage() {
  const router = useRouter();
  const { data, error, mutate } = useSWR<AccountData>(ACCOUNT_API_KEY);

  useEffect(() => {
    if (data) router.replace("/dashboard");
    if (error instanceof ApiError && error.status === 401) router.replace("/login");
  }, [data, error, router]);

  if (error && !(error instanceof ApiError && error.status === 401)) {
    return <DataError message={error.message} retry={() => void mutate()} />;
  }

  return <DataLoading label="Opening Simple Ledger…" />;
}
