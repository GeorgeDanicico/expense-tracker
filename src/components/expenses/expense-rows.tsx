"use client";

import { Box, Stack } from "@chakra-ui/react";
import { Pencil, Trash2 } from "lucide-react";
import { memo, useDeferredValue, useMemo, type KeyboardEvent } from "react";

import { CategoryTile } from "@/components/expenses/category-visual";
import { Amount } from "@/components/ui/amount";
import { Collapse } from "@/components/ui/disclosure";
import { GroupLabel } from "@/components/ui/group-label";
import { ListRow } from "@/components/ui/list-row";
import { DELETE_KEYS, focusNeighbour, isDeleteKey, RowActions, SwipeRow, useRowActions, type RowAction } from "@/components/ui/row-actions";
import { useMemberColors } from "@/hooks/use-member-colors";
import { expenseClassificationLabel } from "@/lib/expenses/categories";
import type { Expense, ListedExpense } from "@/lib/expenses/types";
import { relativeDay } from "@/lib/home/today";

/**
 * What a row can do: Edit and Delete in its `⋯` (hover icons on desktop, long-press on phones), a
 * swipe left to delete on phones and the Delete key on desktop. Absent while read-only.
 */
export type ExpenseRowActions = {
  edit: (expense: Expense) => void;
  remove: (expense: Expense) => void;
  /** Rows deleted but still undoable: collapsed until the delete is sent or undone. */
  hidden: ReadonlySet<string>;
};

/** Consecutive expenses of the same day, in the list's order (newest first). */
export function groupByDay<T extends Pick<Expense, "expenseDate">>(expenses: readonly T[]) {
  const groups: { date: string; expenses: T[] }[] = [];
  for (const expense of expenses) {
    const last = groups.at(-1);
    if (last?.date === expense.expenseDate) last.expenses.push(expense);
    else groups.push({ date: expense.expenseDate, expenses: [expense] });
  }
  return groups;
}

/** How many rows a long list draws before the rest (about two screens on a phone). */
const FIRST_ROWS = 30;

/** What a row calls: the part of `ExpenseRowActions` that doesn't change when a delete hides a row. */
type RowHandlers = Pick<ExpenseRowActions, "edit" | "remove">;

function ExpenseRow({ expense, currency, accent, actions }: { expense: ListedExpense; currency: string; accent?: string; actions?: RowHandlers }) {
  const { rowProps, menu } = useRowActions();
  const remove = actions ? () => actions.remove(expense) : undefined;
  const rowActions: RowAction[] | null = actions && remove
    ? [
        { label: "Edit", icon: Pencil, onSelect: () => actions.edit(expense) },
        { label: "Delete", icon: Trash2, tone: "danger", onSelect: remove },
      ]
    : null;
  const row = (
    <ListRow
      as="div"
      {...(rowActions ? rowProps : {})}
      // Desktop: a focused row (or its hover icons) deletes on the Delete key, with Undo.
      {...(remove ? {
        // Not a tab stop: the row's "more" button is the keyboard's way in (Edit, Delete), and Delete
        // works from it too. Clicking the row focuses it for the key.
        tabIndex: -1,
        "data-expense-row": "",
        "aria-keyshortcuts": DELETE_KEYS,
        onKeyDown: (event: KeyboardEvent<HTMLLIElement>) => {
          // The open menu is portalled, but React events bubble out of it: only keys from inside the row count.
          if (!event.currentTarget.contains(event.target as Node) || !isDeleteKey(event)) return;
          event.preventDefault();
          focusNeighbour(event.currentTarget, "[data-expense-row]");
          remove();
        },
      } : {})}
      accent={accent}
      leading={<CategoryTile category={expense.category} />}
      title={expense.description}
      meta={[expense.memberName, expenseClassificationLabel(expense.category, expense.subtype)].filter(Boolean).join(" · ")}
      detail={expense.notes}
      trailing={
        <>
          {rowActions ? <RowActions label={expense.description} actions={rowActions} {...menu} /> : null}
          <Amount value={expense.amount} currency={expense.currency ?? currency} size="sm" />
        </>
      }
    />
  );
  // Phones: swipe left to delete, with Undo.
  return remove ? <SwipeRow left={{ label: "Delete", icon: Trash2, tone: "danger", commit: true, onSwipe: remove }}>{row}</SwipeRow> : row;
}

/**
 * One row in its collapsing item. Memoized (PF11): the ledger re-renders on every key typed in its search and
 * every tap on Filters, and without this each of a month's few hundred rows rendered again each time.
 */
const ExpenseListItem = memo(function ExpenseListItem({ expense, currency, accent, actions, open }: {
  expense: ListedExpense;
  currency: string;
  accent?: string;
  actions?: RowHandlers;
  open: boolean;
}) {
  return (
    <Collapse as="li" open={open}>
      <ExpenseRow expense={expense} currency={currency} accent={accent} actions={actions} />
    </Collapse>
  );
});

/**
 * Expenses grouped by day under "Today", "Yesterday", "Mon 2 Nov" (the one day formatter, audit D9),
 * one list at every width. In the family view each row has its member's colour down its edge and
 * their name in its caption. A row deleted with Undo collapses, and opens again on Undo.
 */
export function ExpenseRows({
  expenses,
  currency,
  actions,
  now = new Date(),
}: {
  expenses: readonly ListedExpense[];
  currency: string;
  actions?: ExpenseRowActions;
  now?: Date;
}) {
  const memberColor = useMemberColors();
  // A long list (a month's few hundred rows) draws its first rows at once and the rest right after, in pieces the
  // browser can interrupt, and a different list (another month, a search) is drawn the same way while the old rows stay,
  // dimmed, until the new ones are in. Drawing them all in the tap that asked for them took most of a second [S12].
  const rows = useDeferredValue(expenses, expenses.slice(0, FIRST_ROWS));
  const stale = rows !== expenses;
  const groups = useMemo(() => groupByDay(rows), [rows]);
  const hidden = actions?.hidden;
  // Only the two callbacks go to the rows, so a row that is deleted (the `hidden` set changes) doesn't render the others again.
  const edit = actions?.edit;
  const remove = actions?.remove;
  const handlers = useMemo<RowHandlers | undefined>(() => (edit && remove ? { edit, remove } : undefined), [edit, remove]);
  return (
    <Stack gap="1" opacity={stale ? 0.6 : undefined} aria-busy={stale || undefined}>
      {groups.map((group) => (
        <Box key={group.date}>
          <Collapse open={!group.expenses.every((expense) => hidden?.has(expense.id))}>
            <GroupLabel px="2">{relativeDay(group.date, now)}</GroupLabel>
          </Collapse>
          <Stack as="ul" gap="0.5" m="0" p="0">
            {group.expenses.map((expense) => (
              <ExpenseListItem key={expense.id} expense={expense} currency={currency} accent={memberColor(expense.memberId)} actions={handlers} open={!hidden?.has(expense.id)} />
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  );
}
