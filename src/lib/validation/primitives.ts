import { z } from "zod";

import { isValidDate } from "@/lib/calendar";

/** A UUID identifier; `message` replaces zod's default error text. */
export const idSchema = (message?: string) => z.uuid(message);

type DecimalStringOptions = {
  label: string;
  /** Zero passes the final "greater than zero" check. */
  allowZero?: boolean;
  /** Only selects the wording of the format error: "positive decimal" or "nonnegative decimal". */
  kind: "positive" | "nonnegative";
};

/** A non-negative decimal kept as a string, at most 18 integer digits and 10 decimal places. */
export const decimalString = ({ label, allowZero = false, kind }: DecimalStringOptions) => z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/, `${label} must be a ${kind} decimal.`)
  .refine((value) => {
    const [integerPart, fractionalPart = ""] = value.split(".");
    return integerPart.length <= 18 && fractionalPart.length <= 10;
  }, `${label} must have at most 18 integer digits and 10 decimal places.`)
  .refine((value) => allowZero || Number(value) > 0, `${label} must be greater than zero.`);

/** Three ASCII letters in either case; `currencyCode` uppercases them. */
export const CURRENCY_CODE_PATTERN = /^[A-Za-z]{3}$/;

export const currencyCode = z
  .string()
  .trim()
  .regex(CURRENCY_CODE_PATTERN, "Currency must be a three-letter code.")
  .transform((value) => value.toUpperCase());

/** A real YYYY-MM-DD calendar date (rejects e.g. 2026-02-30). */
export const calendarDate = z.string().refine(isValidDate, "Choose a real calendar date.");
