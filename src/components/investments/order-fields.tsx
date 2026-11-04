"use client";

import { Input } from "@chakra-ui/react";

import type { InvestmentOrderInput } from "@/components/investments/investment-api";
import { FormField, FormRow } from "@/components/ui/form-field";
import { APPLICATION_TIMEZONE } from "@/lib/calendar";
import { utcToZoned, zonedTimeToUtc } from "@/lib/time-zone";

/** Now as a `datetime-local` value on the application's clock (audit D9), the one order times are shown in. */
export function defaultExecutedAt(now = new Date()) {
  const { date, time } = utcToZoned(now, APPLICATION_TIMEZONE);
  return `${date}T${time}`;
}

/** The instant a `datetime-local` value means on the application's clock; anything else is sent as typed. */
export function executedAtInstant(value: string) {
  const [date, time] = value.split("T");
  try {
    return zonedTimeToUtc(date, time ?? "", APPLICATION_TIMEZONE).toISOString();
  } catch {
    return value;
  }
}

/** A text field of a form, empty when absent. */
export const formText = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

/**
 * The order a form describes. The dialogs differ only in where the fixed values come from: a new
 * investment reads them from its form, an existing asset supplies them.
 */
export function orderInput(
  order: Pick<InvestmentOrderInput, "brokerId" | "instrument" | "currency" | "side">,
  formData: FormData,
): InvestmentOrderInput {
  return {
    ...order,
    amount: formText(formData, "amount"),
    quantity: formText(formData, "quantity"),
    unitPrice: formText(formData, "unitPrice"),
    executedAt: executedAtInstant(formText(formData, "executedAt")),
  };
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

      <FormField label="Execution date and time" error={fieldError("executedAt")} hint="Bucharest time, like the rest of the app.">
        <Input name="executedAt" type="datetime-local" defaultValue={defaultExecutedAt()} required />
      </FormField>
    </>
  );
}
