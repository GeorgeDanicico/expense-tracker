import { APPLICATION_TIMEZONE } from "@/lib/calendar";

/** How a reminder repeats: a one-off, or every N weeks, months or years from the first date. */
export const REPEAT_UNITS = ["none", "week", "month", "year"] as const;

export type RepeatUnit = (typeof REPEAT_UNITS)[number];

/** The repeat interval's range, as `reminders.repeat_interval` checks it. */
export const MIN_REPEAT_INTERVAL = 1;
export const MAX_REPEAT_INTERVAL = 12;

/**
 * When a reminder may notify, in minutes before each occurrence. The `reminders.lead_minutes`
 * check constraint lists the same values: change both together.
 */
export const LEAD_TIME_PRESETS = [
  { minutes: 0, label: "At the time" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 1440, label: "1 day before" },
  { minutes: 4320, label: "3 days before" },
  { minutes: 10080, label: "1 week before" },
] as const;

export type LeadMinutes = (typeof LEAD_TIME_PRESETS)[number]["minutes"];

export const LEAD_MINUTES: readonly LeadMinutes[] = LEAD_TIME_PRESETS.map((preset) => preset.minutes);

/** A reminder notifies at no more than this many distinct lead times. */
export const MAX_LEAD_TIMES = 3;

export const DEFAULT_TIME_OF_DAY = "09:00";
export const DEFAULT_LEAD_MINUTES: LeadMinutes[] = [0];
/** The only time zone offered for now; stored per reminder so others can come later. */
export const DEFAULT_REMINDER_TIMEZONE = APPLICATION_TIMEZONE;

/**
 * Where a reminder stands: `upcoming` before its due day, `due` on the day before its time,
 * `overdue` once its time has passed (until marked done), `snoozed` while a snooze lasts, and
 * `done` once a one-off reminder is marked done.
 */
export const REMINDER_STATES = ["upcoming", "due", "overdue", "snoozed", "done"] as const;

export type ReminderState = (typeof REMINDER_STATES)[number];

/** A user's private reminder, as the API returns it. Instants are ISO strings. */
export type Reminder = {
  id: string;
  title: string;
  notes: string;
  /** The first occurrence, `YYYY-MM-DD` in `timezone`; every later one is counted from it. */
  startsOn: string;
  /** Local wall-clock time of each occurrence, `HH:MM`. */
  timeOfDay: string;
  /** IANA time zone of `startsOn` and `timeOfDay`. */
  timezone: string;
  repeatUnit: RepeatUnit;
  /** Every `repeatInterval` units, 1–12; 1 for a one-off. */
  repeatInterval: number;
  /** Distinct `LEAD_MINUTES` values, at most `MAX_LEAD_TIMES`. */
  leadMinutes: number[];
  /** A muted reminder never notifies; it still shows as due and overdue. */
  notificationsMuted: boolean;
  /** The open occurrence's date; null once a one-off reminder is done. */
  nextDueOn: string | null;
  /** `nextDueOn` at `timeOfDay` in `timezone`; null when `nextDueOn` is. */
  nextDueAt: string | null;
  /** While in the future the reminder leaves Overdue, and it notifies again at that time. */
  snoozedUntil: string | null;
  /** The next time the worker notifies; null when nothing is left to notify or muted. */
  nextNotifyAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** The fields that place a reminder's occurrences in time. */
export type ReminderRecurrence = Pick<Reminder, "startsOn" | "timeOfDay" | "timezone" | "repeatUnit" | "repeatInterval">;

/** The fields that decide when a reminder notifies and what state it's in. */
export type ReminderSchedule = ReminderRecurrence &
  Pick<Reminder, "leadMinutes" | "notificationsMuted" | "nextDueOn" | "snoozedUntil">;
