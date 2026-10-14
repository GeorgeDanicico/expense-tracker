"use client";

import { Button, Flex, Input, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FormEvent, useId, useState } from "react";
import { useSWRConfig } from "swr";

import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterNetWorthChange } from "@/lib/api/invalidate";
import type { NetWorthEntry } from "@/lib/net-worth/types";
import { formatDate, getUtcToday } from "@/lib/calendar";
import { formatInvestmentAmount } from "@/lib/utils/currency";

export function AddNetWorthValuationDialog({
  entry,
  onSuccess,
}: {
  entry: NetWorthEntry;
  onSuccess: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const form = useApiForm();
  const formId = useId();

  if (entry.itemId === null) return null;
  const itemId = entry.itemId;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    void form.submit(async () => {
      await apiRequest<{ valuation: unknown }>(`/api/net-worth/items/${encodeURIComponent(itemId)}/valuations`, {
        method: "POST",
        body: JSON.stringify({
          value: formData.get("value"),
          valuedOn: formData.get("valuedOn"),
        }),
      });
      await afterNetWorthChange(mutate);
      setOpen(false);
      onSuccess();
    }, { fallback: "The value could not be saved." });
  }

  const { fieldError } = form;

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      title="Add a dated value"
      description="Correcting the same date replaces its observation instead of creating a duplicate."
      trigger={
        <Button type="button" size="xs" variant="outline">
          <Plus size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add value
        </Button>
      }
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
            <Input name="value" defaultValue={entry.currentValue ?? ""} type="number" inputMode="decimal" min="0" step="any" autoFocus required />
          </FormField>

          <FormField
            label="Valued on"
            error={fieldError("valuedOn")}
            hint={entry.valuedOn ? `Latest observation: ${formatDate(entry.valuedOn)}` : "Use the date you observed or estimated this value."}
          >
            <Input name="valuedOn" defaultValue={entry.valuedOn ?? getUtcToday()} type="date" required />
          </FormField>

          {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
        </Stack>
      </form>
    </AppDialog>
  );
}
