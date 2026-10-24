"use client";

import { Button, Flex, Stack, Text } from "@chakra-ui/react";
import { History, SquareKanban, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { TodoBoard } from "@/components/todos/todo-board";
import { TodoDialog } from "@/components/todos/todo-dialog";
import { useTodoBoard } from "@/components/todos/use-todo-board";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { useAccount } from "@/hooks/use-account";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";
import type { Todo } from "@/lib/todos/types";

/** Shown to a user without a family, who has no board. */
export function NoFamilyBoard() {
  return (
    <EmptyState
      icon={<SquareKanban size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />}
      title="The to-do board belongs to a family"
      titleAs="h2"
      description="Create a family or join one, and everyone in it shares one board."
      action={(
        <Button asChild size="sm" variant="solid" colorPalette="brand">
          <Link href="/settings/family">Go to Settings → Family</Link>
        </Button>
      )}
    />
  );
}

/** The family to-do board page: header, the three columns and the card dialog. */
export function TodoBoardScreen() {
  const { account } = useAccount();
  const hasFamily = Boolean(account?.membership);
  const board = useTodoBoard({ enabled: hasFamily });
  const { data: family } = useSWR<FamilyResponse>(hasFamily ? FAMILY_API_KEY : null);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = openId ? board.todos?.find((todo) => todo.id === openId) : undefined;

  const header = <PageHeader title="To-dos" description={account?.membership?.familyName ? `Shared by everyone in ${account.membership.familyName}` : undefined} />;

  if (account && (!hasFamily || board.noFamily)) {
    return (
      <Stack gap={{ base: "4", md: "5" }}>
        {header}
        <NoFamilyBoard />
      </Stack>
    );
  }
  if (board.error && !board.todos) {
    return (
      <Stack gap={{ base: "4", md: "5" }}>
        {header}
        <DataError message="The board could not be loaded." retry={board.refresh} />
      </Stack>
    );
  }
  if (!board.todos) return <DataLoading label="Loading the board…" />;

  return (
    <Stack gap={{ base: "4", md: "5" }}>
      {header}
      {board.moveError ? (
        <InlineAlert
          status="warning"
          action={(
            <IconButton aria-label="Dismiss" size="xs" onClick={board.dismissMoveError}>
              <X size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
            </IconButton>
          )}
        >
          {board.moveError}
        </InlineAlert>
      ) : null}
      <TodoBoard
        todos={board.todos}
        onAdd={board.add}
        onMove={board.move}
        onOpen={(todo: Todo) => setOpenId(todo.id)}
        onDraggingChange={board.setDragging}
        doneFooter={board.canShowOlder ? (
          <Flex justify="center" mt="2">
            <Button variant="ghost" size="xs" color="fg.muted" onClick={board.showOlder}>
              <History size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" />
              {board.showingOlder ? "Show even older" : "Show older"}
            </Button>
          </Flex>
        ) : (
          <Text textStyle="caption" textAlign="center" mt="2">Showing every done card.</Text>
        )}
      />
      {opened ? (
        <TodoDialog
          key={opened.id}
          todo={opened}
          members={family?.family?.members ?? []}
          open
          onOpenChange={(open) => { if (!open) setOpenId(null); }}
          onSave={board.update}
          onDelete={board.remove}
        />
      ) : null}
    </Stack>
  );
}
