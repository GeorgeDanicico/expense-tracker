import { z } from "zod";

import { CREATE, defineTool, READ, UPDATE } from "@/lib/mcp/define-tool";
import { completeReminder, createReminder, listReminders, type ReminderWithState } from "@/lib/reminders/service";
import {
  MAX_LEAD_TIMES,
  MAX_REPEAT_INTERVAL,
  MIN_REPEAT_INTERVAL,
  REMINDER_STATES,
  REPEAT_UNITS,
  type LeadMinutes,
} from "@/lib/reminders/types";
import { idSchema } from "@/lib/validation/primitives";
import { reminderSchema } from "@/lib/validation/reminder";

/**
 * The lead-time presets by name, as the tools take and show them. The values are
 * `LEAD_TIME_PRESETS`' minutes; `satisfies` keeps the two lists in step.
 */
const LEAD_TIMES = {
  at_time: 0,
  "1_hour": 60,
  "1_day": 1440,
  "3_days": 4320,
  "1_week": 10080,
} as const satisfies Record<string, LeadMinutes>;

type LeadTimeName = keyof typeof LEAD_TIMES;

const LEAD_TIME_NAMES = Object.keys(LEAD_TIMES) as [LeadTimeName, ...LeadTimeName[]];

function leadTimeName(minutes: number): string {
  return LEAD_TIME_NAMES.find((name) => LEAD_TIMES[name] === minutes) ?? `${minutes}_minutes`;
}

/**
 * A reminder as the tools show it: its next occurrence as a Europe/Bucharest date and time, lead
 * times by name, without the notification bookkeeping.
 */
function toolReminder(reminder: ReminderWithState) {
  return {
    id: reminder.id,
    title: reminder.title,
    notes: reminder.notes,
    state: reminder.state,
    nextDueOn: reminder.nextDueOn,
    timeOfDay: reminder.timeOfDay,
    startsOn: reminder.startsOn,
    repeatUnit: reminder.repeatUnit,
    repeatInterval: reminder.repeatInterval,
    leadTimes: reminder.leadMinutes.map(leadTimeName),
    notificationsMuted: reminder.notificationsMuted,
    snoozedUntil: reminder.snoozedUntil,
  };
}

const listSchema = z.object({
  state: z.enum(REMINDER_STATES).optional().describe("Omit for every reminder"),
});

const addSchema = z.object({
  title: z.string(),
  startsOn: z.string().describe("The first date, YYYY-MM-DD"),
  timeOfDay: z.string().optional().describe("HH:MM in Europe/Bucharest; defaults to 09:00"),
  repeatUnit: z.enum(REPEAT_UNITS).optional().describe("Defaults to none (a one-off)"),
  repeatInterval: z.number().optional()
    .describe(`Every N weeks, months or years, ${MIN_REPEAT_INTERVAL}-${MAX_REPEAT_INTERVAL}; defaults to 1`),
  leadTimes: z.array(z.enum(LEAD_TIME_NAMES)).optional()
    .describe(`When to notify before each occurrence, at most ${MAX_LEAD_TIMES}; defaults to ["at_time"]`),
  notes: z.string().optional(),
  notificationsMuted: z.boolean().optional().describe("Never notify; it still shows as due and overdue"),
});

const idInput = z.object({ id: idSchema() });

/** Validates with the reminder form's schema, reporting lead-time errors under `leadTimes`. */
function parseReminder({ leadTimes, ...fields }: z.output<typeof addSchema>) {
  const parsed = reminderSchema.safeParse({ ...fields, leadMinutes: leadTimes?.map((name) => LEAD_TIMES[name]) });
  if (parsed.success) return parsed.data;
  throw new z.ZodError(parsed.error.issues.map((issue) => (
    issue.path[0] === "leadMinutes" ? { ...issue, path: ["leadTimes", ...issue.path.slice(1)] } : issue
  )));
}

export const reminderTools = [
  defineTool({
    name: "list_reminders",
    title: "List reminders",
    description: "Your own reminders with their state and next due date and time, soonest first. A done one-off has no next date.",
    schema: listSchema,
    annotations: READ,
    run: async ({ state }) => {
      const { reminders } = await listReminders();
      return {
        reminders: reminders
          .filter((reminder) => state === undefined || reminder.state === state)
          .map(toolReminder),
      };
    },
  }),
  defineTool({
    name: "add_reminder",
    title: "Add reminder",
    description: "Add a private reminder, once or repeating every N weeks, months or years from its first date.",
    schema: addSchema,
    annotations: CREATE,
    run: async (input, { userId }) => ({ reminder: toolReminder(await createReminder(userId, parseReminder(input))) }),
  }),
  defineTool({
    name: "complete_reminder",
    title: "Complete reminder",
    description: "Mark a reminder's open occurrence done. Returns the reminder at its next occurrence; a one-off becomes done.",
    schema: idInput,
    // Calling it again marks the next occurrence done, so unlike the other updates it isn't idempotent.
    annotations: { ...UPDATE, idempotentHint: false },
    run: async ({ id }) => ({ reminder: toolReminder(await completeReminder(id)) }),
  }),
];
