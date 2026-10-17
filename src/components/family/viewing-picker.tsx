"use client";

import { Button, chakra, Flex } from "@chakra-ui/react";
import { Users } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId } from "react";
import useSWR from "swr";

import { MemberSwatch } from "@/components/family/member-swatch";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { useAccount } from "@/hooks/use-account";
import { useViewing } from "@/hooks/use-viewing";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";
import { FILTER_KEYS } from "@/lib/expenses/filters";
import { memberColorTokens } from "@/lib/family/member-colors";
import type { FamilyMember } from "@/lib/family/repository";
import { ALL_MEMBERS, MEMBER_PARAM } from "@/lib/family/viewing";
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
 * "Viewing: Me · Family · <member> …" for the finance pages: one chip per choice, each member's led by
 * their colour, so whose data is on screen is always visible. It shows for a parent, and for a kid with
 * Family finance on, and only when the family has someone else to look at. The choice lives in the URL
 * as `?member=`; "Me" removes it. A saved tab and its filters belong to one member, so switching drops them.
 */
export function ViewingPicker({ allowFamily = false }: { allowFamily?: boolean }) {
  const labelId = useId();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { account } = useAccount();
  const { member, family } = useViewing();
  const membership = account?.membership ?? null;
  const allowed = membership !== null && can(membership, "family_finance", "view");
  const { data } = useSWR<FamilyResponse>(allowed ? FAMILY_API_KEY : null);

  if (!allowed || !membership) return null;
  const others = (data?.family?.members ?? []).filter(
    (entry) => entry.memberId.toLowerCase() !== membership.memberId.toLowerCase(),
  );
  if (!others.length) return null;
  // From the list fetched above, so a member who can't use this picker doesn't load the family for it.
  const colors = memberColorTokens(data?.family?.members ?? []);
  const memberColor = (id: string) => colors.get(id.toLowerCase());

  const familySelected = allowFamily && family;
  const selected = familySelected
    ? ALL_MEMBERS
    : (others.find((entry) => entry.memberId.toLowerCase() === member?.toLowerCase())?.memberId ?? ME);

  const choices = [
    { value: ME, label: "Me", icon: <MemberSwatch color={memberColor(membership.memberId)} /> },
    ...(allowFamily
      ? [{ value: ALL_MEMBERS, label: "Family", icon: <Users size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> }]
      : []),
    ...others.map((entry) => ({
      value: entry.memberId,
      label: memberLabel(entry),
      icon: <MemberSwatch color={memberColor(entry.memberId)} />,
    })),
  ];

  return (
    <Flex align="center" gap="2" wrap="wrap" maxW="full" role="group" aria-labelledby={labelId}>
      <chakra.span id={labelId} textStyle="label" flexShrink="0" me="1">
        Viewing
      </chakra.span>
      {choices.map((choice) => {
        const pressed = choice.value === selected;
        return (
          <Button
            key={choice.value || "me"}
            size="sm"
            variant={pressed ? "solid" : "outline"}
            colorPalette={pressed ? "brand" : undefined}
            aria-pressed={pressed}
            onClick={() => {
              if (!pressed) router.push(viewingHref(pathname, searchParams, choice.value), { scroll: false });
            }}
          >
            {choice.icon}
            {choice.label}
          </Button>
        );
      })}
    </Flex>
  );
}

/** "You're viewing Ana's expenses": shown on a finance page only while it is read-only. */
export function ViewingBar({ noun }: { noun: string }) {
  const { readOnly, family, name } = useViewing();
  if (!readOnly) return null;
  const subject = family ? "the whole family's" : `${name}'s`;
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
      You&apos;re viewing {subject} {noun}. Nothing here can be changed.
    </Flex>
  );
}

/**
 * The picker and the read-only bar for one finance page; `noun` completes "You're viewing Ana's …".
 * `family` adds the "Family (everyone)" choice, for the pages that can show every member at once.
 */
export function ViewingControls({ noun, family = false }: { noun: string; family?: boolean }) {
  return (
    <>
      <ViewingPicker allowFamily={family} />
      <ViewingBar noun={noun} />
    </>
  );
}
