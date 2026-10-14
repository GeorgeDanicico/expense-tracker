import { z } from "zod";

import { purchaseAmountAllowed } from "@/lib/net-worth/rules";
import { NET_WORTH_ITEM_KINDS } from "@/lib/net-worth/types";
import { currencyCode, decimalString } from "@/lib/validation/primitives";

const categoryPattern = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;

const nonnegativeDecimal = (label: string) => decimalString({ label, allowZero: true, kind: "nonnegative" });

const categorySchema = z
  .string()
  .trim()
  .min(1, "Choose or enter a category.")
  .max(40, "Category must be 40 characters or fewer.")
  .transform((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))
  .refine((value) => categoryPattern.test(value), "Use letters, numbers, spaces or hyphens for the category.");

const purchaseAmountSchema = nonnegativeDecimal("Purchase amount");

export const netWorthItemSchema = z.object({
  name: z.string().trim().min(1, "Enter an item name.").max(120),
  kind: z.enum(NET_WORTH_ITEM_KINDS),
  category: categorySchema,
  currency: currencyCode,
  purchaseAmount: purchaseAmountSchema.nullable().optional(),
  value: nonnegativeDecimal("Value"),
  valuedOn: z.iso.date("Choose a valid valuation date."),
}).superRefine((value, context) => {
  if (!purchaseAmountAllowed(value.kind, value.category) && value.purchaseAmount !== undefined && value.purchaseAmount !== null) {
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
  value: nonnegativeDecimal("Value"),
  valuedOn: z.iso.date("Choose a valid valuation date."),
});
