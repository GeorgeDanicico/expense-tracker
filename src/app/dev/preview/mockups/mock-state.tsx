"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

import { MOCK_EXPENSES, type MockExpense } from "./mockup-data";
import type { QuickAddKind } from "./mockups";

/** The undo toast's message and its one action. */
export type ToastMessage = { message: string; action?: string; onAction?: () => void };

type MockState = {
  expenses: MockExpense[];
  /** Ids of expenses added in this visit, for the row-in animation. */
  added: ReadonlySet<string>;
  /** This month's total, following adds and deletes. */
  total: number;
  /** Adds an expense to the top of the list and returns its id. */
  addExpense: (expense: Omit<MockExpense, "id" | "day" | "member">) => string;
  removeExpense: (id: string) => void;
  restoreExpense: (id: string) => void;
  removed: ReadonlySet<string>;
  toast: ToastMessage | null;
  showToast: (toast: ToastMessage) => void;
  hideToast: () => void;
  quickAdd: QuickAddKind | null;
  openQuickAdd: (kind?: QuickAddKind) => void;
  closeQuickAdd: () => void;
  lastKind: QuickAddKind;
};

const Context = createContext<MockState | null>(null);

/** A set of ids with a setter that adds (`on`) or removes one: what's done, deleted or cleared. */
export function useIdSet() {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const set = useCallback(
    (id: string, on: boolean) =>
      setIds((current) => {
        const next = new Set(current);
        if (on) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  return [ids, set] as const;
}

/** How long the undo toast stays (U4's UndoToast: 5 s). */
const TOAST_MS = 5000;

/**
 * In-memory state shared by a mockup and the shell around it, so a quick-add save shows up on Home
 * and a swiped row can come back. Nothing leaves the page.
 */
export function MockStateProvider({ initialQuickAdd = null, children }: { initialQuickAdd?: QuickAddKind | null; children: ReactNode }) {
  const [expenses, setExpenses] = useState(MOCK_EXPENSES);
  const [added, setAdded] = useIdSet();
  const [removed, setRemoved] = useIdSet();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [quickAdd, setQuickAdd] = useState<QuickAddKind | null>(initialQuickAdd);
  const [lastKind, setLastKind] = useState<QuickAddKind>(initialQuickAdd ?? "expense");
  const timer = useRef<number | undefined>(undefined);
  const nextId = useRef(0);

  const hideToast = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);
  const showToast = useCallback((next: ToastMessage) => {
    window.clearTimeout(timer.current);
    setToast(next);
    timer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const value = useMemo<MockState>(() => {
    const total = expenses.filter((expense) => !removed.has(expense.id)).reduce((sum, expense) => sum + expense.amount, 0);
    return {
      expenses,
      added,
      removed,
      total,
      addExpense: (expense) => {
        nextId.current += 1;
        const id = `new-${nextId.current}`;
        setExpenses((list) => [{ ...expense, id, member: "ana", day: "Today" }, ...list]);
        setAdded(id, true);
        return id;
      },
      removeExpense: (id) => setRemoved(id, true),
      restoreExpense: (id) => setRemoved(id, false),
      toast,
      showToast,
      hideToast,
      quickAdd,
      openQuickAdd: (kind) => {
        const chosen = kind ?? lastKind;
        setLastKind(chosen);
        setQuickAdd(chosen);
      },
      closeQuickAdd: () => setQuickAdd(null),
      lastKind,
    };
  }, [expenses, added, removed, setAdded, setRemoved, toast, showToast, hideToast, quickAdd, lastKind]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMockState() {
  const state = useContext(Context);
  if (!state) throw new Error("useMockState needs a MockStateProvider");
  return state;
}
