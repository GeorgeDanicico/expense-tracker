import { z } from "zod";

import { INVESTMENT_BROKER_IDS } from "@/lib/investments/types";

const instrumentQuerySchema = z
  .string()
  .trim()
  .min(1, "Enter an instrument symbol.")
  .max(80, "Instrument symbols must be 80 characters or fewer.")
  .transform((value) => value.toUpperCase());

const currencyQuerySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Currency must be a three-letter code.")
  .transform((value) => value.toUpperCase());

export const investmentTransactionQuerySchema = z.object({
  accountId: z.uuid("Account identifier is invalid."),
  instrument: instrumentQuerySchema,
  currency: currencyQuerySchema,
});

export const investmentBrokerIdSchema = z.enum(INVESTMENT_BROKER_IDS);
