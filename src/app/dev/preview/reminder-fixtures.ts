import type { ReminderApi, ReminderFields } from "@/components/reminders/reminder-api";
import { ApiError } from "@/lib/api/client";
import { addDays, getBucharestToday } from "@/lib/calendar";
import type { ReminderCompletion } from "@/lib/reminders/repository";
import type { ListedReminder } from "@/lib/reminders/list";
import { dueAt, nextNotifyAt, nextOccurrenceAfter, snoozeEnd, stateOf } from "@/lib/reminders/schedule";
import { DEFAULT_REMINDER_TIMEZONE, type Reminder } from "@/lib/reminders/types";
import { utcToZoned } from "@/lib/time-zone";

// The reminders for `/dev/preview/reminders`: samples kept in memory around today, and a fake API
// that works the dates out with `schedule.ts` the way the service does, so adding, editing, marking
// done and snoozing work without a session. `?failWrites=1` refuses every mark done and snooze
// (to see the rollback); `?noReminders=1` starts empty.

const HOUR = 60 * 60 * 1000;
const TZ = DEFAULT_REMINDER_TIMEZONE;

let store: Reminder[] | null = null;
let completions: ReminderCompletion[] = [];
let counter = 0;

function param(name: string) {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).has(name);
}

function withDates(reminder: Omit<Reminder, "nextDueAt" | "nextNotifyAt">, now = new Date()): Reminder {
  return {
    ...reminder,
    nextDueAt: reminder.nextDueOn === null ? null : dueAt(reminder, reminder.nextDueOn).toISOString(),
    nextNotifyAt: nextNotifyAt(reminder, now)?.toISOString() ?? null,
  };
}

type Sample = Partial<Reminder> & Pick<Reminder, "title" | "nextDueOn">;

function sample(id: string, values: Sample): Reminder {
  const now = new Date().toISOString();
  return withDates({
    id,
    notes: "",
    startsOn: values.nextDueOn ?? getBucharestToday(),
    timeOfDay: "09:00",
    timezone: TZ,
    repeatUnit: "none",
    repeatInterval: 1,
    leadMinutes: [0],
    notificationsMuted: false,
    snoozedUntil: null,
    createdAt: now,
    updatedAt: now,
    ...values,
  });
}

function seed(): Reminder[] {
  if (param("noReminders")) return [];
  const now = new Date();
  const today = getBucharestToday(now);
  // Due later today (two hours from now), and overdue by three hours, whatever the time.
  const later = utcToZoned(new Date(now.getTime() + 2 * HOUR), TZ);
  const earlier = utcToZoned(new Date(now.getTime() - 3 * HOUR), TZ);
  const lastMonth = addDays(today, -30);

  completions = [
    { id: "c-rent", reminderId: "r-rent", occurrenceOn: lastMonth, doneAt: new Date(now.getTime() - 30 * 24 * HOUR + HOUR).toISOString(), expenseId: null },
    { id: "c-passport", reminderId: "r-passport", occurrenceOn: addDays(today, -5), doneAt: new Date(now.getTime() - 5 * 24 * HOUR).toISOString(), expenseId: null },
    { id: "c-plants", reminderId: "r-plants", occurrenceOn: addDays(today, -12), doneAt: new Date(now.getTime() - 12 * 24 * HOUR).toISOString(), expenseId: null },
  ];

  return [
    sample("r-rent", {
      title: "Pay the rent", notes: "Transfer to the landlord's account, reference: flat 12.",
      startsOn: lastMonth, nextDueOn: later.date, timeOfDay: later.time, repeatUnit: "month", leadMinutes: [0, 1440, 4320],
    }),
    sample("r-electricity", {
      title: "Electricity bill", nextDueOn: earlier.date, timeOfDay: earlier.time, repeatUnit: "month", leadMinutes: [0, 1440],
    }),
    sample("r-bank", {
      title: "Call the bank about the new card", nextDueOn: addDays(today, -2), timeOfDay: "10:00",
    }),
    sample("r-dentist", {
      title: "Book the dentist for Ana", nextDueOn: addDays(today, -1), timeOfDay: "16:00", repeatUnit: "month", repeatInterval: 6,
      snoozedUntil: snoozeEnd({ kind: "tomorrow" }, now, TZ).toISOString(),
    }),
    sample("r-plants", {
      title: "Water the plants", startsOn: addDays(today, -12), nextDueOn: addDays(today, 2), timeOfDay: "19:30",
      repeatUnit: "week", repeatInterval: 2, notificationsMuted: true,
    }),
    sample("r-insurance", {
      title: "Renew the car insurance", nextDueOn: addDays(today, 6), repeatUnit: "year", leadMinutes: [0, 1440, 10080],
    }),
    sample("r-swimming", {
      title: "Swimming club fees", nextDueOn: addDays(today, 20), timeOfDay: "08:00", repeatUnit: "month", repeatInterval: 3,
    }),
    sample("r-passport", {
      title: "Get passport photos taken", startsOn: addDays(today, -5), nextDueOn: null, timeOfDay: "12:00",
    }),
  ];
}

function reminders(): Reminder[] {
  store ??= seed();
  return store;
}

function listed(reminder: Reminder, now = new Date()): ListedReminder {
  return { ...reminder, state: stateOf(reminder, now) };
}

/** `GET /api/reminders` in the preview. */
export function previewReminders() {
  const now = new Date();
  return {
    reminders: reminders().map((reminder) => listed(reminder, now)),
    completions: [...completions].sort((a, b) => b.doneAt.localeCompare(a.doneAt)),
  };
}

/** `GET /api/reminders/summary` in the preview. */
export function previewReminderSummary() {
  const states = previewReminders().reminders.map((reminder) => reminder.state);
  return { due: states.filter((state) => state === "due").length, overdue: states.filter((state) => state === "overdue").length };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function find(id: string) {
  const reminder = reminders().find((item) => item.id === id);
  if (!reminder) throw new ApiError("Reminder not found.", 404);
  return reminder;
}

function save(reminder: Reminder) {
  store = reminders().some((item) => item.id === reminder.id)
    ? reminders().map((item) => (item.id === reminder.id ? reminder : item))
    : [...reminders(), reminder];
  return listed(reminder);
}

function refuseIfAsked() {
  if (param("failWrites")) throw new ApiError("This reminder changed in another tab. Refresh and try again.", 409);
}

export const previewReminderApi: ReminderApi = {
  async create(fields: ReminderFields) {
    await delay(250);
    const now = new Date().toISOString();
    return save(withDates({
      ...fields, id: `r-new-${++counter}`, timezone: TZ, nextDueOn: fields.startsOn, snoozedUntil: null, createdAt: now, updatedAt: now,
    }));
  },
  async update(id, fields) {
    await delay(250);
    const current = find(id);
    const lastDone = completions
      .filter((completion) => completion.reminderId === id)
      .map((completion) => completion.occurrenceOn)
      .sort()
      .at(-1);
    const values = { ...current, ...fields };
    const nextDueOn = lastDone === undefined ? fields.startsOn : nextOccurrenceAfter(values, lastDone);
    const snoozedUntil = nextDueOn === current.nextDueOn ? current.snoozedUntil : null;
    return save(withDates({ ...values, nextDueOn, snoozedUntil, updatedAt: new Date().toISOString() }));
  },
  async remove(id) {
    await delay(250);
    find(id);
    store = reminders().filter((reminder) => reminder.id !== id);
    completions = completions.filter((completion) => completion.reminderId !== id);
  },
  async complete(id) {
    await delay(600);
    refuseIfAsked();
    const current = find(id);
    if (current.nextDueOn === null) throw new ApiError("This reminder is already done.", 409);
    completions = [
      { id: `c-new-${++counter}`, reminderId: id, occurrenceOn: current.nextDueOn, doneAt: new Date().toISOString(), expenseId: null },
      ...completions,
    ];
    const nextDueOn = nextOccurrenceAfter(current, current.nextDueOn);
    return save(withDates({ ...current, nextDueOn, snoozedUntil: null, updatedAt: new Date().toISOString() }));
  },
  async snooze(id, snooze) {
    await delay(600);
    refuseIfAsked();
    const current = find(id);
    const snoozedUntil = snoozeEnd(snooze, new Date(), current.timezone).toISOString();
    return save(withDates({ ...current, snoozedUntil, updatedAt: new Date().toISOString() }));
  },
};
