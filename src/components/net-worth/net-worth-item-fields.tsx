"use client";

import { Input, NativeSelect } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { FormField, FormRow } from "@/components/ui/form-field";
import type { NetWorthItemKind } from "@/lib/net-worth/types";

export type CategoryOption = { value: string; label: string };

/**
 * Fields shared by the add and edit item dialogs: name, category (with a
 * custom label), and the optional purchase amount for non-cash assets.
 */
export function NetWorthItemFields({
  kind,
  category,
  onCategoryChange,
  categoryOptions,
  customCategory,
  onCustomCategoryChange,
  fieldError,
  defaultName,
  defaultPurchaseAmount,
  customCategoryHint,
  kindField,
  beforePurchase,
}: {
  kind: NetWorthItemKind;
  category: string;
  onCategoryChange: (category: string) => void;
  categoryOptions: CategoryOption[];
  customCategory: string;
  onCustomCategoryChange: (value: string) => void;
  fieldError: (name: string) => string | undefined;
  defaultName?: string;
  defaultPurchaseAmount?: string;
  customCategoryHint?: string;
  /** Optional "Type" select rendered beside the category. */
  kindField?: ReactNode;
  /** Extra fields rendered before the purchase amount (e.g. currency). */
  beforePurchase?: ReactNode;
}) {
  const categorySelect = (
    <FormField flex="1" label="Category" error={fieldError("category")}>
      <NativeSelect.Root>
        <NativeSelect.Field
          name="category"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
        >
          {categoryOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
    </FormField>
  );

  return (
    <>
      <FormField label="Name" error={fieldError("name")}>
        <Input name="name" defaultValue={defaultName} autoFocus placeholder={defaultName ? undefined : "e.g. BCR current account"} required />
      </FormField>

      {kindField ? (
        <FormRow>
          {kindField}
          {categorySelect}
        </FormRow>
      ) : categorySelect}

      {category === "custom" ? (
        <FormField label="Custom category" error={fieldError("category")} hint={customCategoryHint}>
          <Input
            value={customCategory}
            onChange={(event) => onCustomCategoryChange(event.target.value)}
            placeholder={customCategoryHint ? "e.g. Collectibles" : undefined}
            required
          />
        </FormField>
      ) : null}

      {beforePurchase}

      {kind === "asset" && category !== "cash" ? (
        <FormField
          label="Optional purchase amount"
          error={fieldError("purchaseAmount")}
          hint="Comparison baseline only, not a tax-grade cost basis."
        >
          <Input name="purchaseAmount" defaultValue={defaultPurchaseAmount} type="number" inputMode="decimal" min="0" step="any" placeholder="Leave blank if unknown" />
        </FormField>
      ) : null}
    </>
  );
}
