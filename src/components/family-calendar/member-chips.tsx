"use client";

import { Button, chakra, Flex } from "@chakra-ui/react";
import { Users } from "lucide-react";
import { useId } from "react";

import { Avatar } from "@/components/ui/avatar";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import type { FamilyMember } from "@/lib/family/repository";
import { isFilterOn, type CalendarMemberFilter } from "@/lib/family-calendar/filters";

function memberLabel(member: FamilyMember) {
  return member.displayName ?? member.username ?? "Unnamed";
}

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Button
      size="sm"
      variant={pressed ? "solid" : "outline"}
      colorPalette={pressed ? "brand" : undefined}
      aria-pressed={pressed}
      flexShrink="0"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * The chips above the calendar, as on the to-do board: Everyone, Me and each other member with
 * their avatar and colour. A pressed chip filters the calendar to the events that member attends;
 * the screen keeps the choice in the URL as `?member=`. On a phone the row scrolls sideways inside
 * itself, never the page.
 */
export function MemberChips({
  filter,
  members,
  myMemberId,
  myAvatarUrl,
  colorOf,
  onChange,
}: {
  filter: CalendarMemberFilter;
  /** The whole family; the caller is left out, since "Me" stands for them. */
  members: readonly FamilyMember[];
  myMemberId: string | null;
  myAvatarUrl?: string | null;
  colorOf: (memberId: string | null | undefined) => string | undefined;
  onChange: (filter: CalendarMemberFilter) => void;
}) {
  const label = useId();
  const me = members.find((member) => member.memberId.toLowerCase() === myMemberId?.toLowerCase());
  const others = members.filter((member) => member.memberId.toLowerCase() !== myMemberId?.toLowerCase());

  return (
    <Flex
      align="center"
      gap="2"
      wrap={{ base: "nowrap", md: "wrap" }}
      overflowX={{ base: "auto", md: "visible" }}
      minW="0"
      // Room for the focus ring, which the scroll container would otherwise clip.
      p={{ base: "1", md: "0" }}
      m={{ base: "-1", md: "0" }}
      css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
      role="group"
      aria-labelledby={label}
    >
      <chakra.span id={label} textStyle="label" flexShrink="0" me="1">
        Showing
      </chakra.span>
      <Chip pressed={filter === "all"} onClick={() => onChange("all")}>
        <Users size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
        Everyone
      </Chip>
      {myMemberId ? (
        <Chip pressed={isFilterOn(filter, myMemberId, myMemberId)} onClick={() => onChange("me")}>
          <Avatar size="xs" name={me ? memberLabel(me) : "Me"} src={me?.avatarUrl ?? myAvatarUrl} color={colorOf(myMemberId)} decorative />
          Me
        </Chip>
      ) : null}
      {others.map((member) => (
        <Chip key={member.memberId} pressed={isFilterOn(filter, member.memberId, myMemberId)} onClick={() => onChange(member.memberId)}>
          <Avatar size="xs" name={memberLabel(member)} src={member.avatarUrl} color={colorOf(member.memberId)} decorative />
          {memberLabel(member)}
        </Chip>
      ))}
    </Flex>
  );
}
