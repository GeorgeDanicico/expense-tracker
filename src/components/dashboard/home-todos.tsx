"use client";

import { Box, Text } from "@chakra-ui/react";
import { SquareKanban } from "lucide-react";
import { useMemo } from "react";

import { useTodoBoard } from "@/components/todos/use-todo-board";
import { HomeBlockPending, type BlockPending } from "@/components/dashboard/home-skeleton";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON } from "@/components/ui/icon";
import { IconTile } from "@/components/ui/icon-tile";
import { ListRow } from "@/components/ui/list-row";
import { SectionLink } from "@/components/ui/section-link";
import { ListSkeleton } from "@/components/ui/skeletons";
import { relativeDay, openTodosFor } from "@/lib/home/today";
import { isOverdue } from "@/lib/todos/filters";
import { TODO_STATUS_LABELS } from "@/lib/todos/types";

const header = <Card.Header title="To-dos for you" actions={<SectionLink href="/todos">Board</SectionLink>} />;

/** The to-dos before their data: the skeleton or the error (PF6). */
export function FamilyTodosPending(state: BlockPending) {
  return <HomeBlockPending {...state} header={header} label="Loading your to-dos…" skeleton={<ListSkeleton rows={3} gap="0" />} errorMessage="The board could not be loaded." />;
}

/** The family's open to-dos assigned to the signed-in member. Only rendered for a user with a family. */
export function FamilyTodos({ memberId, now }: { memberId: string; now: Date }) {
  const board = useTodoBoard();
  const { shown, more } = useMemo(() => openTodosFor(board.todos ?? [], memberId), [board.todos, memberId]);
  if (!board.todos) return <FamilyTodosPending error={board.error} retry={board.refresh} />;
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
