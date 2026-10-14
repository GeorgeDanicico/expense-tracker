import { z } from "zod";

import { INVESTMENT_BROKER_IDS } from "@/lib/investments/types";
import { currencyCode, decimalString, idSchema } from "@/lib/validation/primitives";

const instrumentQuerySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9.-]{0,19}$/, "Use a valid instrument symbol (up to 20 letters, numbers, dots or hyphens).")
  .transform((value) => value.toUpperCase());

const positiveDecimal = (label: string) => decimalString({ label, kind: "positive" });

const executedAtSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Choose a valid execution date and time.")
  .transform((value) => new Date(value).toISOString());

export const investmentTransactionQuerySchema = z.object({
  accountId: idSchema("Account identifier is invalid."),
  instrument: instrumentQuerySchema,
  currency: currencyCode,
});

const investmentBrokerIdSchema = z.enum(INVESTMENT_BROKER_IDS);

export const investmentTransactionSchema = z.object({
  brokerId: investmentBrokerIdSchema,
  instrument: instrumentQuerySchema,
  currency: currencyCode,
  side: z.enum(["buy", "sell"]),
  amount: positiveDecimal("Amount"),
  quantity: positiveDecimal("Quantity"),
  unitPrice: positiveDecimal("Unit price"),
  executedAt: executedAtSchema,
});
