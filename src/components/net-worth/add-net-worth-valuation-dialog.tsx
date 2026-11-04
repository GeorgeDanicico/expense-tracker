"use client";

import { Flex, Input, Stack, Text } from "@chakra-ui/react";
import { FormEvent, useId } from "react";

import { useNetWorthWrites } from "@/components/net-worth/use-net-worth-writes";
import { AmountInput } from "@/components/ui/amount-input";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { formatDate, getBucharestToday } from "@/lib/calendar";
import type { NetWorthEntry } from "@/lib/net-worth/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";

/**
 * A new dated value for a manual item, in a sheet opened from its row's actions. The row shows the
 * value at once and goes back if the save fails (the one optimistic write here).
 */
export function AddNetWorthValuationDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: NetWorthEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const writes = useNetWorthWrites();
  const form = useApiForm();
  const formId = useId();

  if (entry.itemId === null) return null;
  const itemId = entry.itemId;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    void form.submit(async () => {
      await writes.addValuation(itemId, { value: String(formData.get("value") ?? ""), valuedOn: String(formData.get("valuedOn") ?? "") });
      onOpenChange(false);
    }, { fallback: "The value could not be saved." });
  }

  const { fieldError } = form;

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) form.reset();
      }}
      title="Add a dated value"
      description="Correcting the same date replaces its observation instead of creating a duplicate."
      footer={<FormActions form={formId} closesDialog pending={form.pending} submitLabel="Save value" />}
    >
      <form id={formId} onSubmit={submit} aria-busy={form.pending}>
        <Stack gap="3">
          <Flex align="center" justify="space-between" gap="3" px="3" py="2.5" borderRadius="control" bg="bg.subtle">
            <Stack minW="0" gap="0">
              <Text textStyle="bodySm" fontWeight="medium" truncate>{entry.name}</Text>
              <Text textStyle="caption">{entry.currency} · {entry.kind === "liability" ? "amount owed" : "owned value"}</Text>
            </Stack>
            <Text textStyle="amountSm" whiteSpace="nowrap">
              {entry.currentValue === null ? "No value" : formatInvestmentAmount(entry.currentValue, entry.currency)}
            </Text>
          </Flex>

          <FormField label={entry.kind === "liability" ? "Amount owed" : "Current value"} error={fieldError("value")}>
            <AmountInput name="value" currency={entry.currency} autoFocus required />
          </FormField>

          <ValuedOnField latestObservation={entry.valuedOn} error={fieldError("valuedOn")} />

          {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
        </Stack>
      </form>
    </AppDialog>
  );
}

/** The date of a new value: today, so a quick save adds an observation instead of replacing the latest. */
export function ValuedOnField({ latestObservation, error }: { latestObservation: string | null; error?: string }) {
  return (
    <FormField
      label="Valued on"
      error={error}
      hint={latestObservation ? `Latest observation: ${formatDate(latestObservation)}` : "Use the date you observed or estimated this value."}
    >
      <Input name="valuedOn" defaultValue={getBucharestToday()} type="date" required />
    </FormField>
  );
}
