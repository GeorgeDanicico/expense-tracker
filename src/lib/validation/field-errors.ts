import { z } from "zod";

/** Messages per field, as the API sends them in `fieldErrors` and the forms show them. */
export type FieldErrors = Record<string, string[]>;

/**
 * The field errors of a failed zod parse: one list of messages per top-level field. Every route,
 * service and form takes them from here, so the same mistake gives the same `fieldErrors`
 * (docs/lint-rules.md, `no-zod-flatten`).
 */
export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  return z.flattenError(error).fieldErrors as FieldErrors;
}
