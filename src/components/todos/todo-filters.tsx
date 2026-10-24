"use client";

import { Box, Button, chakra, Flex } from "@chakra-ui/react";
import { AlarmClock, CalendarCheck, UserRoundX, Users } from "lucide-react";
import { useId } from "react";

import { Avatar } from "@/components/ui/avatar";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import type { FamilyMember } from "@/lib/family/repository";
import type { TodoDueFilter, TodoFilters } from "@/lib/todos/filters";

function memberLabel(member: FamilyMember) {
  return member.displayName ?? member.username ?? "Unnamed";
}

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
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
 * The board's chips: whose cards (Everyone, Me, each other member with their avatar and colour,
 * Unassigned) and, combined with that, Due today or Overdue. Pressing a pressed due chip turns it
 * off. The screen keeps the choice in the URL.
 */
export function TodoFilterChips({
  filters,
  members,
  myMemberId,
  myAvatarUrl,
  colorOf,
  onChange,
}: {
  filters: TodoFilters;
  /** The whole family; the caller is left out, since "Me" stands for them. */
  members: readonly FamilyMember[];
  myMemberId: string | null;
  myAvatarUrl?: string | null;
  colorOf: (memberId: string | null | undefined) => string | undefined;
  onChange: (filters: TodoFilters) => void;
}) {
  const assigneeLabel = useId();
  const dueLabel = useId();
  const me = members.find((member) => member.memberId.toLowerCase() === myMemberId?.toLowerCase());
  const others = members.filter((member) => member.memberId.toLowerCase() !== myMemberId?.toLowerCase());
  const setAssignee = (assignee: string) => onChange({ ...filters, assignee });
  const toggleDue = (due: Exclude<TodoDueFilter, "any">) => onChange({ ...filters, due: filters.due === due ? "any" : due });

  return (
    // Phones: whose cards in one row that scrolls sideways (inside itself, never the page), the due
    // chips in a second row. From `md` up everything wraps as one line with a divider.
    <Flex
      direction={{ base: "column", md: "row" }}
      align={{ base: "stretch", md: "center" }}
      wrap={{ md: "wrap" }}
      gap="2"
      minW="0"
    >
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
        aria-labelledby={assigneeLabel}
      >
        <chakra.span id={assigneeLabel} textStyle="label" flexShrink="0" me="1">
          Showing
        </chakra.span>
        <Chip pressed={filters.assignee === "all"} onClick={() => setAssignee("all")}>
          <Users size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Everyone
        </Chip>
        {myMemberId ? (
          <Chip pressed={filters.assignee === "me"} onClick={() => setAssignee("me")}>
            <Avatar size="xs" name={me ? memberLabel(me) : "Me"} src={me?.avatarUrl ?? myAvatarUrl} color={colorOf(myMemberId)} decorative />
            Me
          </Chip>
        ) : null}
        {others.map((member) => (
          <Chip
            key={member.memberId}
            pressed={filters.assignee.toLowerCase() === member.memberId.toLowerCase()}
            onClick={() => setAssignee(member.memberId)}
          >
            <Avatar size="xs" name={memberLabel(member)} src={member.avatarUrl} color={colorOf(member.memberId)} decorative />
            {memberLabel(member)}
          </Chip>
        ))}
        <Chip pressed={filters.assignee === "unassigned"} onClick={() => setAssignee("unassigned")}>
          <UserRoundX size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Unassigned
        </Chip>
      </Flex>
      <Box display={{ base: "none", md: "block" }} w="1px" h="6" bg="border" mx="1" aria-hidden="true" />
      <Flex align="center" gap="2" wrap="wrap" role="group" aria-labelledby={dueLabel}>
        <chakra.span id={dueLabel} className="sr-only">Due</chakra.span>
        <Chip pressed={filters.due === "today"} onClick={() => toggleDue("today")}>
          <CalendarCheck size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Due today
        </Chip>
        <Chip pressed={filters.due === "overdue"} onClick={() => toggleDue("overdue")}>
          <AlarmClock size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
          Overdue
        </Chip>
      </Flex>
    </Flex>
  );
}
