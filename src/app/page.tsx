"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { DataError, DataLoading } from "@/components/ui/data-state";
import { useAccount } from "@/hooks/use-account";
import { ApiError } from "@/lib/api/client";

export default function HomePage() {
  const router = useRouter();
  const { account: data, error, mutate } = useAccount();

  useEffect(() => {
    if (data) router.replace("/dashboard");
    if (error instanceof ApiError && error.status === 401) router.replace("/login");
  }, [data, error, router]);

  if (error && !(error instanceof ApiError && error.status === 401)) {
    return <DataError message={error.message} retry={() => void mutate()} />;
  }

  return <DataLoading layout="screen" label="Opening Simple Ledger…" />;
}
