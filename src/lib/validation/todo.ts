import { z } from "zod";

import { TODO_STATUSES } from "@/lib/todos/types";
import { calendarDate, idSchema } from "@/lib/validation/primitives";

const title = z.string().trim().min(1, "Enter a title.").max(200, "Use at most 200 characters.");
const notes = z.string().trim().max(2000, "Use at most 2,000 characters.");
const assigneeMemberId = idSchema("Choose a member of your family.").nullable();
const dueDate = calendarDate.nullable();
const status = z.enum(TODO_STATUSES);

/** A new card. Notes default to empty, assignee and due date to null, status to "todo". */
export const todoSchema = z.object({
  title,
  notes: notes.default(""),
  assigneeMemberId: assigneeMemberId.default(null),
  dueDate: dueDate.default(null),
  status: status.default("todo"),
});

export type TodoInput = z.output<typeof todoSchema>;

/** A change to a card: any subset of its fields, at least one. Moves go through `moveSchema`. */
export const todoPatchSchema = z.object({
  title: title.optional(),
  notes: notes.optional(),
  assigneeMemberId: assigneeMemberId.optional(),
  dueDate: dueDate.optional(),
}).strict().refine((patch) => Object.values(patch).some((value) => value !== undefined), {
  message: "Change at least one field.",
});

export type TodoPatch = z.output<typeof todoPatchSchema>;

/**
 * Where to put a card: its column and the cards that will sit above (`beforeId`) and below
 * (`afterId`) it. Both null means an empty column.
 */
export const moveSchema = z.object({
  status,
  beforeId: idSchema().nullable(),
  afterId: idSchema().nullable(),
}).refine((move) => move.beforeId === null || move.beforeId !== move.afterId, {
  message: "A card can't sit both above and below the same card.", path: ["afterId"],
});

export type TodoMove = z.output<typeof moveSchema>;

/** `GET /api/todos` query: `doneSince`, an ISO timestamp (UTC or with an offset), or absent for the default window. */
export const todoListQuerySchema = z.object({
  doneSince: z.iso.datetime({ offset: true, error: "Use an ISO timestamp for doneSince." })
    .transform((value) => new Date(value).toISOString())
    .optional(),
});
