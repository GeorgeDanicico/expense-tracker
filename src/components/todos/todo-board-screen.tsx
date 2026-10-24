"use client";

import { Button, Flex, Stack, Text } from "@chakra-ui/react";
import { History, SquareKanban, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { TodoBoard } from "@/components/todos/todo-board";
import { TodoDialog } from "@/components/todos/todo-dialog";
import { TodoFilterChips } from "@/components/todos/todo-filters";
import { useTodoBoard } from "@/components/todos/use-todo-board";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { useAccount } from "@/hooks/use-account";
import { useIsPhone } from "@/hooks/use-is-phone";
import { useMemberColors } from "@/hooks/use-member-colors";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";
import {
  filterTodos,
  hasTodoFilters,
  hiddenByFilterNotice,
  hidingFilter,
  parseTodoFilters,
  quickAddFields,
  todoFiltersHref,
  type TodoFilters,
} from "@/lib/todos/filters";
import type { Todo, TodoStatus } from "@/lib/todos/types";

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

/** "Showing 3 of 9 cards" with a way back to everything, while a filter is on. */
function FilterSummary({ shown, total, onClear }: { shown: number; total: number; onClear: () => void }) {
  return (
    <Flex align="center" gap="2" wrap="wrap" role="status">
      <Text textStyle="caption">
        Showing {shown} of {total} {total === 1 ? "card" : "cards"}.
      </Text>
      <Button variant="plain" size="xs" color="fg.accent" px="0" h="auto" minW="0" onClick={onClear}>
        Clear filters
      </Button>
    </Flex>
  );
}

/**
 * The family to-do board page: header, the filter chips (kept in the URL as `?member=` and
 * `?due=`), the three columns (one at a time on a phone) and the card dialog. Needs a Suspense
 * boundary above it for `useSearchParams`.
 */
export function TodoBoardScreen() {
  const { account } = useAccount();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const phone = useIsPhone();
  const colorOf = useMemberColors();
  const hasFamily = Boolean(account?.membership);
  const myMemberId = account?.membership?.memberId ?? null;
  const board = useTodoBoard({ enabled: hasFamily });
  const { data: family } = useSWR<FamilyResponse>(hasFamily ? FAMILY_API_KEY : null);
  const members = family?.family?.members;
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = openId ? board.todos?.find((todo) => todo.id === openId) : undefined;

  const { assignee, due } = parseTodoFilters(searchParams, members?.map((member) => member.memberId));
  const filters = useMemo<TodoFilters>(() => ({ assignee, due }), [assignee, due]);
  const visible = useMemo(
    () => (board.todos ? filterTodos(board.todos, filters, myMemberId) : undefined),
    [board.todos, filters, myMemberId],
  );
  // The native History API syncs `useSearchParams` without a server round trip (filtering is
  // client-side), and replacing keeps chip clicks out of the back button's history.
  // Quick add pre-fills from the filters so the new card stays in view; when it can't (Overdue),
  // it says the card was added but is hidden rather than letting it vanish.
  const addFiltered = async (title: string, status: TodoStatus) => {
    const todo = await board.add(title, status, quickAddFields(filters, myMemberId));
    const hiddenBy = hidingFilter(todo, filters, myMemberId);
    return hiddenBy ? hiddenByFilterNotice(hiddenBy) : undefined;
  };
  const setFilters = (next: TodoFilters) => window.history.replaceState(null, "", todoFiltersHref(pathname, searchParams, next));

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
  if (!board.todos || !visible) return <DataLoading label="Loading the board…" />;

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
      <Stack gap="2">
        <TodoFilterChips
          filters={filters}
          members={members ?? []}
          myMemberId={myMemberId}
          myAvatarUrl={account?.avatarUrl}
          colorOf={colorOf}
          onChange={setFilters}
        />
        {hasTodoFilters(filters) ? (
          <FilterSummary shown={visible.length} total={board.todos.length} onClear={() => setFilters({ assignee: "all", due: "any" })} />
        ) : null}
      </Stack>
      <TodoBoard
        todos={visible}
        singleColumn={phone}
        onAdd={addFiltered}
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
