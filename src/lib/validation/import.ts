import { z } from "zod";

import { IMPORT_MAX_ROWS } from "@/lib/imports/types";
import { expenseSchema } from "@/lib/validation/expense";
import { idSchema } from "@/lib/validation/primitives";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One confirmed row: the row's `id` and the fields of `expenseSchema`, so a confirmed row obeys
 * exactly the rules of a hand-typed expense (a description of 1 to 120 characters, an amount
 * greater than zero, a subtype that belongs to the category). `safeExtend` keeps the schema's
 * subtype check. The review screen may send `notes: null` for a row without notes; it means none.
 */
export const confirmImportRowSchema = z.preprocess(
  (row) => (isRecord(row) && row.notes === null ? { ...row, notes: undefined } : row),
  expenseSchema.safeExtend({ id: idSchema("Choose rows of this import.") }),
);

/**
 * The body of `POST /api/imports/[id]/confirm`: the ticked rows with their final values, 1 to 500.
 * A row id appears once. That each id belongs to the batch, and the currency, are checked by the
 * service and the database.
 */
export const confirmImportSchema = z.object({
  rows: z
    .array(confirmImportRowSchema)
    .min(1, "Choose at least one row to import.")
    .max(IMPORT_MAX_ROWS, `Import at most ${IMPORT_MAX_ROWS} rows at a time.`),
}).superRefine((body, context) => {
  const seen = new Set<string>();
  body.rows.forEach((row, index) => {
    if (seen.has(row.id)) {
      context.addIssue({ code: "custom", path: ["rows", index, "id"], message: "Each row can be imported only once." });
    }
    seen.add(row.id);
  });
});

export type ConfirmImportInput = z.output<typeof confirmImportSchema>;
export type ConfirmImportRowInput = z.output<typeof confirmImportRowSchema>;
