"use client";

import { Box, Flex, Text } from "@chakra-ui/react";
import { CalendarDays } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { Avatar } from "@/components/ui/avatar";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { useMemberColors } from "@/hooks/use-member-colors";
import { getBucharestToday } from "@/lib/calendar";
import { isOverdue } from "@/lib/todos/filters";
import type { Todo } from "@/lib/todos/types";

/** "Oct 25" this year, "Oct 25, 2027" in another. */
export function formatDueDate(date: string, now = new Date()) {
  const sameYear = date.slice(0, 4) === getBucharestToday(now).slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

/** The assignee's name as the card shows it. */
export function assigneeName(todo: Pick<Todo, "assignee">) {
  return todo.assignee?.name ?? "A family member";
}

type TodoCardProps = Omit<ComponentPropsWithoutRef<"div">, "color"> & {
  todo: Todo;
  /** The card left behind while it's dragged: a faded placeholder. */
  placeholder?: boolean;
  /** The copy that follows the pointer while dragging. */
  overlay?: boolean;
};

/**
 * One card: title, due date (red once overdue) and the assignee's avatar. The board makes it
 * draggable and clickable; this only draws it.
 */
export const TodoCard = forwardRef<HTMLDivElement, TodoCardProps>(function TodoCard(
  { todo, placeholder = false, overlay = false, ...props },
  ref,
) {
  const colorOf = useMemberColors();
  const overdue = isOverdue(todo);

  return (
    <Box
      ref={ref}
      bg="bg.surface"
      borderWidth="1px"
      borderColor={overlay ? "border.strong" : "border"}
      borderRadius="l3"
      boxShadow={overlay ? "overlay" : "xs"}
      px="3"
      py="2.5"
      cursor={overlay ? "grabbing" : "pointer"}
      opacity={placeholder ? 0.4 : 1}
      outline="none"
      _hover={{ borderColor: "border.strong" }}
      _focusVisible={{ outline: "2px solid", outlineColor: "colorPalette.focusRing", outlineOffset: "2px" }}
      colorPalette="brand"
      // Long-press drags on touch; the page keeps scrolling until then.
      touchAction="manipulation"
      userSelect="none"
      {...props}
    >
      <Text textStyle="bodySm" color="fg" fontWeight="medium" wordBreak="break-word" lineClamp={4}>
        {todo.title}
      </Text>
      {todo.dueDate || todo.assignee ? (
        <Flex mt="2" align="center" justify="space-between" gap="2" minH="6">
          {todo.dueDate ? (
            <Flex align="center" gap="1" color={overdue ? "fg.error" : "fg.muted"} textStyle="label">
              <CalendarDays size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <Text as="span">
                {overdue ? <Text as="span" className="sr-only">Overdue, due </Text> : <Text as="span" className="sr-only">Due </Text>}
                {formatDueDate(todo.dueDate)}
              </Text>
            </Flex>
          ) : <span />}
          {todo.assignee ? (
            <Avatar
              size="xs"
              name={assigneeName(todo)}
              src={todo.assignee.avatarUrl}
              color={colorOf(todo.assignee.memberId)}
            />
          ) : null}
        </Flex>
      ) : null}
    </Box>
  );
});
