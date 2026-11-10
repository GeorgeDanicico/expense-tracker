"use client";

import { Box, Text } from "@chakra-ui/react";
import { SquareKanban } from "lucide-react";
import { useMemo } from "react";

import { useTodoBoard } from "@/components/todos/use-todo-board";
import { Card } from "@/components/ui/card";
import { DataError } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON } from "@/components/ui/icon";
import { IconTile } from "@/components/ui/icon-tile";
import { ListRow } from "@/components/ui/list-row";
import { SectionLink } from "@/components/ui/section-link";
import { SkeletonFrame } from "@/components/ui/skeleton-frame";
import { ListSkeleton } from "@/components/ui/skeletons";
import { relativeDay, openTodosFor } from "@/lib/home/today";
import { isOverdue } from "@/lib/todos/filters";
import { TODO_STATUS_LABELS } from "@/lib/todos/types";

/** The family's open to-dos assigned to the signed-in member. Only rendered for a user with a family. */
export function FamilyTodos({ memberId, now }: { memberId: string; now: Date }) {
  const board = useTodoBoard();
  const { shown, more } = useMemo(() => openTodosFor(board.todos ?? [], memberId), [board.todos, memberId]);
  const header = <Card.Header title="To-dos for you" actions={<SectionLink href="/todos">Board</SectionLink>} />;
  if (!board.todos) {
    return (
      <Card size="sm">
        {header}
        <Card.Body>
          {board.error ? <DataError message="The board could not be loaded." retry={board.refresh} /> : <SkeletonFrame label="Loading your to-dos…"><ListSkeleton rows={3} gap="0" /></SkeletonFrame>}
        </Card.Body>
      </Card>
    );
  }
  return (
    <Card size="sm">
      {header}
      <Card.Body>
        {shown.length === 0 ? (
          <EmptyState size="sm" titleAs="p" icon={<SquareKanban size={ICON.nav} aria-hidden="true" />} title="Nothing assigned to you" description="Cards the family gives you show up here." />
        ) : (
          <Box as="ul" m="0" p="0">
            {shown.map((todo) => (
              <ListRow
                key={todo.id}
                leading={<IconTile icon={SquareKanban} bg="bg.muted" color="fg.muted" />}
                title={todo.title}
                meta={
                  <>
                    {TODO_STATUS_LABELS[todo.status]}
                    {todo.dueDate ? (
                      <Text as="span" color={isOverdue(todo, now) ? "fg.error" : undefined}> · {relativeDay(todo.dueDate, now)}</Text>
                    ) : null}
                  </>
                }
              />
            ))}
          </Box>
        )}
        {more > 0 ? <Text textStyle="caption" px="2" pt="1">+{more} more on the board.</Text> : null}
      </Card.Body>
    </Card>
  );
}
