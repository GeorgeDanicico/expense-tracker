import { randomUUID } from "node:crypto";

import {
  occurrenceAlreadyDoneError,
  summarizeReminders,
  type ReminderCompletion,
  type ReminderNextOccurrence,
  type ReminderRepository,
  type ReminderValues,
} from "@/lib/reminders/repository";
import { DEFAULT_REMINDER_TIMEZONE, type Reminder } from "@/lib/reminders/types";

/** A reminder as the fake stores it: a `Reminder` with its owner. */
export type FakeReminderRow = Reminder & { userId: string };

/** The test user of `@/test/route`, whom the fake acts as unless `callerId` changes. */
const TEST_USER_ID = "10000000-0000-4000-8000-000000000001";

/**
 * In-memory `ReminderRepository` acting as `callerId`. Like RLS, every method sees only the
 * caller's reminders (another user's counts as missing), and completions follow their reminder.
 * Like the database, `complete` moves the reminder only while `occurrenceOn` is its open occurrence
 * (409 otherwise), clears the snooze, and keeps one completion per occurrence.
 *
 * Seed with `seed({ ... })` (a one-off on 2026-11-01 at 09:00 by default, owned by the caller; pass
 * the dates too, as the fake stores what it's given) or push onto `rows` and `completions`.
 */
export class FakeReminderRepository implements ReminderRepository {
  callerId = TEST_USER_ID;
  rows: FakeReminderRow[] = [];
  completions: ReminderCompletion[] = [];

  seed(overrides: Partial<FakeReminderRow> = {}): FakeReminderRow {
    const now = new Date().toISOString();
    const row: FakeReminderRow = {
      id: randomUUID(),
      userId: this.callerId,
      title: "Pay rent",
      notes: "",
      startsOn: "2026-11-01",
      timeOfDay: "09:00",
      timezone: DEFAULT_REMINDER_TIMEZONE,
      repeatUnit: "none",
      repeatInterval: 1,
      leadMinutes: [0],
      notificationsMuted: false,
      nextDueOn: "2026-11-01",
      nextDueAt: "2026-11-01T07:00:00.000Z",
      snoozedUntil: null,
      nextNotifyAt: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
    this.rows.push(row);
    return row;
  }

  async list({ doneSince }: { doneSince: string }) {
    const own = this.own();
    const ids = new Set(own.map((row) => row.id));
    return {
      reminders: own
        .toSorted((a, b) => compareNullsLast(a.nextDueAt, b.nextDueAt) || a.createdAt.localeCompare(b.createdAt))
        .map(toReminder),
      completions: this.completions
        .filter((completion) => ids.has(completion.reminderId) && completion.doneAt >= doneSince)
        .toSorted((a, b) => b.doneAt.localeCompare(a.doneAt)),
    };
  }

  async get(id: string) {
    const row = this.find(id);
    return row ? toReminder(row) : null;
  }

  async lastCompletedOn(id: string) {
    if (!this.find(id)) return null;
    return this.completions
      .filter((completion) => completion.reminderId === id)
      .map((completion) => completion.occurrenceOn)
      .toSorted()
      .at(-1) ?? null;
  }

  async create(userId: string, values: ReminderValues) {
    const now = new Date().toISOString();
    const row: FakeReminderRow = { id: randomUUID(), userId, ...values, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return toReminder(row);
  }

  async update(id: string, values: Partial<ReminderValues>) {
    const row = this.find(id);
    if (!row) return null;
    const defined = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
    Object.assign(row, defined, { updatedAt: new Date().toISOString() });
    return toReminder(row);
  }

  async delete(id: string) {
    const row = this.find(id);
    if (!row) return false;
    this.rows = this.rows.filter((other) => other !== row);
    this.completions = this.completions.filter((completion) => completion.reminderId !== id);
    return true;
  }

  async complete(id: string, occurrenceOn: string, next: ReminderNextOccurrence) {
    const row = this.find(id);
    if (!row) return null;
    if (row.nextDueOn !== occurrenceOn) throw occurrenceAlreadyDoneError();

    Object.assign(row, next, { snoozedUntil: null, updatedAt: new Date().toISOString() });
    if (!this.completions.some((completion) => completion.reminderId === id && completion.occurrenceOn === occurrenceOn)) {
      this.completions.push({
        id: randomUUID(), reminderId: id, occurrenceOn, doneAt: new Date().toISOString(), expenseId: null,
      });
    }
    return toReminder(row);
  }

  async summary(now: Date) {
    return summarizeReminders(this.own(), now);
  }

  private own() {
    return this.rows.filter((row) => row.userId === this.callerId);
  }

  private find(id: string) {
    return this.rows.find((row) => row.id === id && row.userId === this.callerId);
  }
}

function compareNullsLast(a: string | null, b: string | null) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a.localeCompare(b);
}

function toReminder({ userId, ...reminder }: FakeReminderRow): Reminder {
  void userId;
  return { ...reminder, leadMinutes: [...reminder.leadMinutes] };
}
