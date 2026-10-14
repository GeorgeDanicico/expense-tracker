"use client";

import { Button, Flex, Input, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FormEvent, useId, useState } from "react";
import { useSWRConfig } from "swr";

import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField, FormRow } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { ApiError, apiRequest } from "@/lib/api/client";
import { afterInvestmentChange } from "@/lib/api/invalidate";
import { investmentTransactionsApiKey } from "@/lib/api/keys";
import {
  INVESTMENT_BROKER_LABELS,
  type InvestmentBrokerId,
  type InvestmentOverviewAsset,
  type InvestmentTransactionMutationResponse,
} from "@/lib/investments/types";

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

export function AddOrderDialog({
  accountId,
  brokerId,
  asset,
}: {
  accountId: string;
  brokerId: InvestmentBrokerId;
  asset: InvestmentOverviewAsset;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const formId = useId();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setFieldErrors(undefined);

    const formData = new FormData(event.currentTarget);
    try {
      await apiRequest<InvestmentTransactionMutationResponse>("/api/investment-transactions", {
        method: "POST",
        body: JSON.stringify({
          brokerId,
          instrument: asset.instrument,
          currency: asset.currency,
          side: formData.get("side"),
          amount: formData.get("amount"),
          quantity: formData.get("quantity"),
          unitPrice: formData.get("unitPrice"),
          executedAt: formTimestamp(formData.get("executedAt")),
        }),
      });

      const detailKey = investmentTransactionsApiKey({
        accountId,
        instrument: asset.instrument,
        currency: asset.currency,
      });
      await afterInvestmentChange(mutate, detailKey);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The order could not be saved.");
      setFieldErrors(caught instanceof ApiError ? caught.fieldErrors : undefined);
    } finally {
      setPending(false);
    }
  }

  function fieldError(name: string) {
    return fieldErrors?.[name]?.[0];
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      title="Add order"
      trigger={
        <Button type="button" size="xs" variant="solid" colorPalette="brand">
          <Plus size={ICON.xs} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add order
        </Button>
      }
      footer={<FormActions form={formId} closesDialog pending={pending} submitLabel="Save order" />}
    >
      <form id={formId} onSubmit={submit} aria-busy={pending}>
        <Stack gap="3">
          <Flex gap="2" wrap="wrap" align="center">
            <StatusBadge tone="brand">{INVESTMENT_BROKER_LABELS[brokerId]}</StatusBadge>
            <Text textStyle="bodySm" fontWeight="medium">{asset.instrument}</Text>
            <Text textStyle="bodySm" color="fg.muted">{asset.currency}</Text>
          </Flex>

          <FormField
            label="Order side"
            error={fieldError("side")}
            hint="A sell is checked against units available at its execution time."
          >
            <NativeSelect.Root>
              <NativeSelect.Field name="side" defaultValue="buy" autoFocus>
                <option value="buy">Buy</option>
                <option value="sell">Sell</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </FormField>

          <FormRow>
            <FormField flex="1" label="Quantity" error={fieldError("quantity")}>
              <Input name="quantity" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required />
            </FormField>
            <FormField flex="1" label="Unit price" error={fieldError("unitPrice")}>
              <Input name="unitPrice" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required />
            </FormField>
          </FormRow>

          <FormField
            label={`Order amount (${asset.currency})`}
            error={fieldError("amount")}
            hint="Total order value in the instrument currency."
          >
            <Input name="amount" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required />
          </FormField>

          <FormField label="Execution date and time" error={fieldError("executedAt")}>
            <Input name="executedAt" type="datetime-local" defaultValue={localDateTimeValue()} required />
          </FormField>

          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}

          <Text className="sr-only" role="status" aria-live="polite">
            {pending ? "Saving order…" : ""}
          </Text>
        </Stack>
      </form>
    </AppDialog>
  );
}
