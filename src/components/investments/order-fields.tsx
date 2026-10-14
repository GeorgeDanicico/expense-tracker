"use client";

import { Input } from "@chakra-ui/react";

import { FormField, FormRow } from "@/components/ui/form-field";
import { apiRequest } from "@/lib/api/client";
import type { InvestmentTransactionMutationResponse } from "@/lib/investments/types";

function localDateTimeValue() {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

function formTimestamp(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return value;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
}

/** Quantity, unit price, amount and execution time — the fields every order records. */
export function OrderFields({
  fieldError,
  amountLabel,
  amountHint,
}: {
  fieldError: (name: string) => string | undefined;
  amountLabel: string;
  amountHint: string;
}) {
  return (
    <>
      <FormRow>
        <FormField flex="1" label="Quantity" error={fieldError("quantity")}>
          <Input name="quantity" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required />
        </FormField>
        <FormField flex="1" label="Unit price" error={fieldError("unitPrice")}>
          <Input name="unitPrice" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required />
        </FormField>
      </FormRow>

      <FormField label={amountLabel} error={fieldError("amount")} hint={amountHint}>
        <Input name="amount" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required />
      </FormField>

      <FormField label="Execution date and time" error={fieldError("executedAt")}>
        <Input name="executedAt" type="datetime-local" defaultValue={localDateTimeValue()} required />
      </FormField>
    </>
  );
}

/**
 * Records one order. The dialogs differ only in where the fixed values come
 * from: a new investment reads them from its form, an existing asset supplies them.
 */
export function submitInvestmentOrder(
  order: {
    brokerId: FormDataEntryValue | null;
    instrument: FormDataEntryValue | null;
    currency: FormDataEntryValue | null;
    side: FormDataEntryValue | null;
  },
  formData: FormData,
) {
  return apiRequest<InvestmentTransactionMutationResponse>("/api/investment-transactions", {
    method: "POST",
    body: JSON.stringify({
      brokerId: order.brokerId,
      instrument: order.instrument,
      currency: order.currency,
      side: order.side,
      amount: formData.get("amount"),
      quantity: formData.get("quantity"),
      unitPrice: formData.get("unitPrice"),
      executedAt: formTimestamp(formData.get("executedAt")),
    }),
  });
}
