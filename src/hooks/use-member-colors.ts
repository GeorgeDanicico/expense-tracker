"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { useAccount } from "@/hooks/use-account";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";
import { memberColorTokens } from "@/lib/family/member-colors";

/**
 * A member's colour token (`member.1` …), from the shared family list. Undefined without a family,
 * until the list loads, and for an id that isn't in it, so callers simply draw no colour.
 */
export function useMemberColors() {
  const { account } = useAccount();
  const { data } = useSWR<FamilyResponse>(account?.membership ? FAMILY_API_KEY : null);
  const colors = useMemo(() => memberColorTokens(data?.family?.members ?? []), [data]);
  return (memberId: string | null | undefined) => (memberId ? colors.get(memberId.toLowerCase()) : undefined);
}
