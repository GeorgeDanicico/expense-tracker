import { addDays, formatLongDay, getBucharestToday, shiftMonth } from "@/lib/calendar";
import type { DashboardData } from "@/lib/expenses/types";
import { formatDay } from "@/lib/reminders/format";
import { groupReminders, type ListedReminder } from "@/lib/reminders/list";
import { utcToZoned } from "@/lib/time-zone";
import type { Todo } from "@/lib/todos/types";

// What Home ("today") shows and how it words it. Pure: the screen passes `now`.

/** The reminders Home lists, and the to-dos: the rest sit behind the block's link. */
export const HOME_REMINDER_LIMIT = 3;
export const HOME_TODO_LIMIT = 3;

const APP_TIME_ZONE = "Europe/Bucharest";

/** "Good morning" until noon, "Good afternoon" until 6 pm, "Good evening" after, on the app's clock. */
export function greeting(now: Date) {
  const hour = Number(utcToZoned(now, APP_TIME_ZONE).time.slice(0, 2));
  return hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/** "Wednesday 4 November": today's date under the greeting. */
export function todayLabel(now: Date) {
  return formatLongDay(getBucharestToday(now));
}

/** "Today", "Yesterday", else "Mon 2 Nov": how Home dates an expense or a due date. */
export function relativeDay(date: string, now: Date) {
  const today = getBucharestToday(now);
  if (date === today) return "Today";
  if (date === addDays(today, -1)) return "Yesterday";
  return formatDay(date, now);
}

/**
 * Home's reminders: what's overdue (the most late first), then what's due today. Snoozed and
 * upcoming ones wait. `shown` is the first few, `more` how many more are due, and `next` the
 * reminder to name when nothing is due.
 */
export function dueReminders(reminders: readonly ListedReminder[], limit = HOME_REMINDER_LIMIT) {
  const { overdue, upcoming } = groupReminders(reminders);
  const due = [...overdue, ...upcoming.filter((reminder) => reminder.state === "due")];
  const next = upcoming.find((reminder) => reminder.state === "upcoming") ?? null;
  return { shown: due.slice(0, limit), more: Math.max(0, due.length - limit), next };
}

/** How a due reminder's line reads: "2 days late" is the reminders module's; today's are "Today, 17:30". */
export function dueTimeLabel(reminder: Pick<ListedReminder, "nextDueAt" | "timezone">) {
  return reminder.nextDueAt ? utcToZoned(new Date(reminder.nextDueAt), reminder.timezone).time : "";
}

/**
 * This month so far against last month's whole total, from the dashboard Home shares with Insights
 * (its series ends on the last completed month). `previousTotal` is 0 when last month had no
 * spending or isn't in the series; `share` is the part of it spent so far, 0 to 1 for the meter.
 */
export function monthSoFar(data: Pick<DashboardData, "currentMonth" | "currentTotal" | "analytics">) {
  const previousMonth = shiftMonth(data.currentMonth, -1);
  const previousTotal = data.analytics.series.find((point) => point.key === previousMonth)?.total ?? 0;
  return {
    previousMonth,
    previousTotal,
    share: previousTotal > 0 ? Math.min(1, data.currentTotal / previousTotal) : 0,
    over: previousTotal > 0 && data.currentTotal > previousTotal ? data.currentTotal - previousTotal : 0,
  };
}

/** The family's open to-dos assigned to `memberId`: the nearest due date first, those without one last. */
export function openTodosFor(todos: readonly Todo[], memberId: string, limit = HOME_TODO_LIMIT) {
  const mine = todos
    .filter((todo) => todo.status !== "done" && todo.assignee?.memberId === memberId)
    .sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || (a.position < b.position ? -1 : 1));
  return { shown: mine.slice(0, limit), more: Math.max(0, mine.length - limit) };
}
