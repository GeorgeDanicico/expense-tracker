import { NAV_ITEMS, type UserSection } from "@/components/layout/nav-items";
import { isTypingTarget } from "@/components/ui/row-actions";

export type QuickAddKind = "expense" | "todo" | "reminder" | "event";

/** The kinds in the sheet's order, each with the page it belongs to: offered only where that page is. */
export const QUICK_ADD_KINDS: readonly { kind: QuickAddKind; label: string; href: string }[] = [
  { kind: "expense", label: "Expense", href: NAV_ITEMS.expenses.href },
  { kind: "todo", label: "To-do", href: NAV_ITEMS.todos.href },
  { kind: "reminder", label: "Reminder", href: NAV_ITEMS.reminders.href },
  { kind: "event", label: "Event", href: NAV_ITEMS.calendar.href },
];

export function isQuickAddKind(value: string): value is QuickAddKind {
  return QUICK_ADD_KINDS.some((entry) => entry.kind === value);
}

/**
 * What the sheet offers someone, from the pages they can reach (`navigationFor`): Expense needs the
 * expenses permission, To-do and Event a family, Reminder nothing.
 */
export function quickAddKindsFor(sections: readonly UserSection[]) {
  const reachable = new Set(sections.flatMap((section) => section.items.map((item) => item.href)));
  return QUICK_ADD_KINDS.filter((entry) => reachable.has(entry.href));
}

/** The kind to open on: the one asked for, else the last one used on this device, else the first offered. */
export function initialKind(offered: readonly QuickAddKind[], asked?: QuickAddKind, remembered?: string | null): QuickAddKind {
  if (asked && offered.includes(asked)) return asked;
  const last = offered.find((kind) => kind === remembered);
  return last ?? offered[0] ?? "reminder";
}

/** Where the sheet remembers the last kind used, per device (decision 3 in docs/ui-direction.md). */
export const LAST_KIND_STORAGE_KEY = "quick-add:last-kind";

export function readLastKind() {
  try {
    return window.localStorage.getItem(LAST_KIND_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function rememberKind(kind: QuickAddKind) {
  try {
    window.localStorage.setItem(LAST_KIND_STORAGE_KEY, kind);
  } catch {
    // Private windows and blocked storage: the sheet just starts on the default next time.
  }
}

/**
 * `N` opens the sheet on desktop: a plain N (no Ctrl, Cmd, Alt), not while typing in a field and
 * not while a dialog is open.
 */
export function isQuickAddShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "repeat" | "defaultPrevented" | "target">, dialogOpen: boolean) {
  if (event.key !== "n" && event.key !== "N") return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || event.defaultPrevented || dialogOpen) return false;
  return !isTypingTarget(event.target);
}
