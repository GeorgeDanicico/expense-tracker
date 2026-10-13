"use client";

import { Button, Input, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FormEvent, useId, useState } from "react";
import { useSWRConfig } from "swr";

import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField, FormRow } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ApiError, apiRequest } from "@/lib/api/client";
import { INVESTMENTS_API_KEY, NET_WORTH_API_KEY } from "@/lib/api/keys";
import {
  INVESTMENT_BROKER_IDS,
  INVESTMENT_BROKER_LABELS,
  type InvestmentTransactionMutationResponse,
} from "@/lib/investments/types";
import { CURRENCY_OPTIONS } from "@/lib/utils/currency";

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

function InvestmentForm({
  id,
  onSuccess,
  onPendingChange,
}: {
  id: string;
  onSuccess: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { mutate } = useSWRConfig();
  const [pending, setPendingState] = useState(false);
  function setPending(next: boolean) {
    setPendingState(next);
    onPendingChange(next);
  }
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const [instrument, setInstrument] = useState("");

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
          brokerId: formData.get("brokerId"),
          instrument: formData.get("instrument"),
          currency: formData.get("currency"),
          side: "buy",
          amount: formData.get("amount"),
          quantity: formData.get("quantity"),
          unitPrice: formData.get("unitPrice"),
          executedAt: formTimestamp(formData.get("executedAt")),
        }),
      });
      await Promise.allSettled([mutate(INVESTMENTS_API_KEY), mutate(NET_WORTH_API_KEY)]);
      onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The investment could not be saved.");
      setFieldErrors(caught instanceof ApiError ? caught.fieldErrors : undefined);
    } finally {
      setPending(false);
    }
  }

  const instrumentCode = instrument.trim().toUpperCase();
  const instrumentHint = instrumentCode
    ? "The latest price will be requested from the configured price service."
    : "Use a listing code such as VWCE.DE or AAPL.US.";

  function fieldError(name: string) {
    return fieldErrors?.[name]?.[0];
  }

  return (
    <form id={id} onSubmit={submit} aria-busy={pending}>
      <Stack gap="3">
        <FormField label="Broker" error={fieldError("brokerId")}>
          <NativeSelect.Root>
            <NativeSelect.Field name="brokerId" defaultValue={INVESTMENT_BROKER_IDS[0]}>
              {INVESTMENT_BROKER_IDS.map((brokerId) => (
                <option key={brokerId} value={brokerId}>{INVESTMENT_BROKER_LABELS[brokerId]}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>

        <FormField label="Instrument / listing symbol" error={fieldError("instrument")} hint={instrumentHint}>
          <Input
            name="instrument"
            value={instrument}
            onChange={(event) => setInstrument(event.target.value)}
            maxLength={20}
            placeholder="e.g. VWCE.DE"
            autoFocus
            required
          />
        </FormField>

        <FormField
          label="Instrument currency"
          error={fieldError("currency")}
          hint="Amount and prices are recorded in this native currency."
        >
          <NativeSelect.Root>
            <NativeSelect.Field name="currency" defaultValue="EUR">
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>{option.code} · {option.label}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>

        <Stack gap="3" pt="3" borderTopWidth="1px" borderColor="border">
          <Text textStyle="label" color="fg.muted">First buy order</Text>
          <FormRow>
            <FormField flex="1" label="Quantity" error={fieldError("quantity")}>
              <Input name="quantity" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required />
            </FormField>
            <FormField flex="1" label="Unit price" error={fieldError("unitPrice")}>
              <Input name="unitPrice" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required />
            </FormField>
          </FormRow>

          <FormField label="Order amount" error={fieldError("amount")} hint="Total order value in the selected currency.">
            <Input name="amount" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required />
          </FormField>

          <FormField label="Execution date and time" error={fieldError("executedAt")}>
            <Input name="executedAt" type="datetime-local" defaultValue={localDateTimeValue()} required />
          </FormField>
        </Stack>

        {error ? <InlineAlert status="error">{error}</InlineAlert> : null}

        <Text className="sr-only" role="status" aria-live="polite">
          {pending ? "Saving investment…" : ""}
        </Text>
      </Stack>
    </form>
  );
}

export function AddInvestmentDialog() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const formId = useId();

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      title="Add investment"
      description="The first recorded order creates the investment under its broker."
      trigger={
        <Button variant="solid" colorPalette="brand" size={{ base: "md", sm: "sm" }} flex={{ base: "1", sm: "initial" }}>
          <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add investment
        </Button>
      }
      footer={<FormActions form={formId} closesDialog pending={pending} submitLabel="Save investment" />}
    >
      <InvestmentForm id={formId} onPendingChange={setPending} onSuccess={() => setOpen(false)} />
    </AppDialog>
  );
}
