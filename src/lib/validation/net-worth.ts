import { z } from "zod";

import { NET_WORTH_ITEM_KINDS } from "@/lib/net-worth/types";

const categoryPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const decimalInputSchema = (label: string, allowZero = false) => z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d+)?$/, `${label} must be a nonnegative decimal.`)
  .refine((value) => {
    const [integerPart, fractionalPart = ""] = value.split(".");
    return integerPart.length <= 18 && fractionalPart.length <= 10;
  }, `${label} must have at most 18 integer digits and 10 decimal places.`)
  .refine((value) => allowZero || Number(value) > 0, `${label} must be greater than zero.`);

const currencySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{3}$/, "Currency must be a three-letter code.")
  .transform((value) => value.toUpperCase());

const categorySchema = z
  .string()
  .trim()
  .min(1, "Choose or enter a category.")
  .max(40, "Category must be 40 characters or fewer.")
  .transform((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
  .refine((value) => categoryPattern.test(value), "Use letters, numbers, spaces or hyphens for the category.");

const purchaseAmountSchema = decimalInputSchema("Purchase amount", true);

export const netWorthItemSchema = z.object({
  name: z.string().trim().min(1, "Enter an item name.").max(120),
  kind: z.enum(NET_WORTH_ITEM_KINDS),
  category: categorySchema,
  currency: currencySchema,
  purchaseAmount: purchaseAmountSchema.nullable().optional(),
  value: decimalInputSchema("Value", true),
  valuedOn: z.iso.date("Choose a valid valuation date."),
}).superRefine((value, context) => {
  if ((value.kind === "liability" || value.category === "cash") && value.purchaseAmount !== undefined && value.purchaseAmount !== null) {
    context.addIssue({
      code: "custom",
      path: ["purchaseAmount"],
      message: "Purchase amount is only available for non-cash assets.",
    });
  }
});

export const netWorthItemPatchSchema = z.object({
  name: z.string().trim().min(1, "Enter an item name.").max(120).optional(),
  category: categorySchema.optional(),
  purchaseAmount: purchaseAmountSchema.nullable().optional(),
  archived: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, "Provide at least one item change.");

export const netWorthValuationSchema = z.object({
  value: decimalInputSchema("Value", true),
  valuedOn: z.iso.date("Choose a valid valuation date."),
});
