"use client";

import { Stack } from "@chakra-ui/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import useSWR from "swr";

import { ManageInvites } from "@/components/family/manage-invites";
import { ManageMembers } from "@/components/family/manage-members";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { useAccount } from "@/hooks/use-account";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";

export default function ManageFamilyPage() {
  useDocumentTitle("Manage family");
  const router = useRouter();
  const { account } = useAccount();
  const isParent = account?.membership?.role === "parent";
  const notAllowed = account !== undefined && account.features.family && !isParent;

  const { data, error, mutate } = useSWR<FamilyResponse>(isParent ? FAMILY_API_KEY : null);

  useEffect(() => {
    if (notAllowed) router.replace("/settings/family");
  }, [notAllowed, router]);

  if (!isParent) return account && !notAllowed ? null : <DataLoading label="Loading…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your family…" />;
  if (!data.family) return null;

  return (
    <Stack gap="6">
      <ManageMembers data={data.family} />
      <ManageInvites />
    </Stack>
  );
}
