"use client";

import { useSearchParams } from "next/navigation";
import useSWR from "swr";

import { useAccount } from "@/hooks/use-account";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";
import type { FamilyMember } from "@/lib/family/repository";
import { MEMBER_PARAM } from "@/lib/family/viewing";

export type ViewingState = {
  /** The viewed member's id for API keys; `null` when viewing yourself (also for `?member=` set to your own id). */
  member: string | null;
  /** True while viewing someone else: every add, edit, delete and import control stays hidden. */
  readOnly: boolean;
  /** The viewed member from the family list; `null` for yourself, or until the family has loaded. */
  viewed: FamilyMember | null;
  /** The viewed member's name for sentences ("Ana"), or "this member" until it is known; "you" for yourself. */
  name: string;
  /** The currency amounts are shown in: the viewed member's, else your own account currency. */
  currency: string;
  /** False only while another member's name and currency are still loading; finance reads wait for it. */
  ready: boolean;
  /** `href` with `?member=` kept, so a link inside a page doesn't drop whose data you're viewing. */
  hrefFor: (href: string) => string;
};

/**
 * Whose finance data the page shows, read from `?member=`. Needs a Suspense boundary above it, like
 * any `useSearchParams` user. The family list is only fetched while viewing someone else.
 */
export function useViewing(): ViewingState {
  const searchParams = useSearchParams();
  const { account, currency: ownCurrency } = useAccount();
  const requested = searchParams.get(MEMBER_PARAM) || null;
  const ownId = account?.membership?.memberId;
  const member = requested && requested.toLowerCase() !== ownId?.toLowerCase() ? requested : null;

  const { data, error } = useSWR<FamilyResponse>(member ? FAMILY_API_KEY : null);
  const viewed = member
    ? (data?.family?.members.find((entry) => entry.memberId.toLowerCase() === member.toLowerCase()) ?? null)
    : null;

  return {
    member,
    readOnly: member !== null,
    viewed,
    name: member ? (viewed?.displayName ?? viewed?.username ?? "this member") : "you",
    currency: viewed?.currency ?? ownCurrency,
    ready: member === null || Boolean(data) || Boolean(error),
    hrefFor: (href) => {
      if (!member) return href;
      const [path, query = ""] = href.split("?");
      const params = new URLSearchParams(query);
      params.set(MEMBER_PARAM, member);
      return `${path}?${params}`;
    },
  };
}
