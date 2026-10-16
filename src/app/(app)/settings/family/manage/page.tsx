"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { Card } from "@/components/ui/card";
import { DataLoading } from "@/components/ui/data-state";
import { useAccount } from "@/hooks/use-account";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function ManageFamilyPage() {
  useDocumentTitle("Manage family");
  const router = useRouter();
  const { account } = useAccount();
  const isParent = account?.membership?.role === "parent";
  const notAllowed = account !== undefined && account.features.family && !isParent;

  useEffect(() => {
    if (notAllowed) router.replace("/settings/family");
  }, [notAllowed, router]);

  if (!isParent) return account && !notAllowed ? null : <DataLoading label="Loading…" />;

  return (
    <Card>
      <Card.Header title="Manage family" description="Members, invites and kid accounts will show up here." />
    </Card>
  );
}
