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

const decimalInputSchema = (label: string) => z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/, `${label} must be a positive decimal.`)
  .refine((value) => {
    const [integerPart, fractionalPart = ""] = value.split(".");
    return integerPart.length <= 18 && fractionalPart.length <= 10;
  }, `${label} must have at most 18 integer digits and 10 decimal places.`)
  .refine((value) => Number(value) > 0, `${label} must be greater than zero.`);

const executedAtSchema = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "Choose a valid execution date and time.")
  .transform((value) => new Date(value).toISOString());

export const investmentTransactionQuerySchema = z.object({
  accountId: z.uuid("Account identifier is invalid."),
  instrument: instrumentQuerySchema,
  currency: currencyQuerySchema,
});

export const investmentBrokerIdSchema = z.enum(INVESTMENT_BROKER_IDS);

export const investmentTransactionSchema = z.object({
  brokerId: investmentBrokerIdSchema,
  instrument: instrumentQuerySchema,
  currency: currencyQuerySchema,
  side: z.enum(["buy", "sell"]),
  amount: decimalInputSchema("Amount"),
  quantity: decimalInputSchema("Quantity"),
  unitPrice: decimalInputSchema("Unit price"),
  executedAt: executedAtSchema,
});
