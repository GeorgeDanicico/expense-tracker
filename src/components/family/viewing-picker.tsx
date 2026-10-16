"use client";

import { chakra, Flex, NativeSelect } from "@chakra-ui/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";
import useSWR from "swr";

import { useAccount } from "@/hooks/use-account";
import { useViewing } from "@/hooks/use-viewing";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";
import { FILTER_KEYS } from "@/lib/expenses/filters";
import type { FamilyMember } from "@/lib/family/repository";
import { MEMBER_PARAM } from "@/lib/family/viewing";
import { can } from "@/lib/permissions";

const ME = "";

function memberLabel(member: FamilyMember) {
  return member.displayName ?? member.username ?? "Unnamed";
}

/** The URL after choosing `value` (a member id, or "" for yourself): `?member=` set or removed, saved tab and filters dropped. */
export function viewingHref(pathname: string, current: { toString(): string }, value: string) {
  const params = new URLSearchParams(current.toString());
  for (const key of ["tab", ...FILTER_KEYS]) params.delete(key);
  if (value === ME) params.delete(MEMBER_PARAM);
  else params.set(MEMBER_PARAM, value);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * "Viewing: Me / <member>" for the finance pages. It shows for a parent, and for a kid with Family
 * finance on, and only when the family has someone else to look at. The choice lives in the URL as
 * `?member=`; "Me" removes it. A saved tab and its filters belong to one member, so switching drops them.
 */
export function ViewingPicker() {
  const id = useId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { account } = useAccount();
  const { member } = useViewing();
  const membership = account?.membership ?? null;
  const allowed = membership !== null && can(membership, "family_finance", "view");
  const { data } = useSWR<FamilyResponse>(allowed ? FAMILY_API_KEY : null);

  if (!allowed || !membership) return null;
  const others = (data?.family?.members ?? []).filter(
    (entry) => entry.memberId.toLowerCase() !== membership.memberId.toLowerCase(),
  );
  if (!others.length) return null;

  const selected = others.find((entry) => entry.memberId.toLowerCase() === member?.toLowerCase());

  function choose(value: string) {
    router.push(viewingHref(pathname, searchParams, value), { scroll: false });
  }

  return (
    <Flex align="center" gap="2" maxW="full">
      <chakra.label htmlFor={id} textStyle="label" flexShrink="0">
        Viewing
      </chakra.label>
      <NativeSelect.Root size="sm" flex={{ base: "1", sm: "none" }} width={{ sm: "14rem" }} minW="0">
        <NativeSelect.Field id={id} value={selected?.memberId ?? ME} onChange={(event) => choose(event.target.value)}>
          <option value={ME}>Me</option>
          {others.map((entry) => (
            <option key={entry.memberId} value={entry.memberId}>
              {memberLabel(entry)}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </Flex>
  );
}

/** "You're viewing Ana's expenses": shown on a finance page only while it is read-only. */
export function ViewingBar({ noun }: { noun: string }) {
  const { readOnly, name } = useViewing();
  if (!readOnly) return null;
  return (
    <Flex
      role="status"
      align="center"
      gap="2"
      px="3"
      py="2"
      borderWidth="1px"
      borderColor="border"
      borderRadius="control"
      bg="bg.subtle"
      textStyle="bodySm"
      color="fg.muted"
    >
      You&apos;re viewing {name}&apos;s {noun}. Nothing here can be changed.
    </Flex>
  );
}

/** The picker and the read-only bar for one finance page; `noun` completes "You're viewing Ana's …". */
export function ViewingControls({ noun }: { noun: string }) {
  return (
    <>
      <ViewingPicker />
      <ViewingBar noun={noun} />
    </>
  );
}
