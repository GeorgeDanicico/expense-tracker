"use client";

import { SimpleGrid } from "@chakra-ui/react";
import useSWR from "swr";

import { CreateFamilyForm } from "@/components/family/create-family-form";
import { JoinFamilyForm } from "@/components/family/join-family-form";
import { FamilyMembers } from "@/components/family/family-members";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";

export default function FamilySettingsPage() {
  useDocumentTitle("Family");
  const { data, error, mutate } = useSWR<FamilyResponse>(FAMILY_API_KEY);

  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your family…" />;

  if (!data.family) {
    return (
      <SimpleGrid columns={{ base: 1, md: 2 }} gap={{ base: "4", md: "5" }} alignItems="start">
        <CreateFamilyForm />
        <JoinFamilyForm />
      </SimpleGrid>
    );
  }

  return <FamilyMembers data={data.family} />;
}
