"use client";

import { Button, Input, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FormEvent, useId, useState } from "react";
import { useSWRConfig } from "swr";

import { OrderFields, submitInvestmentOrder } from "@/components/investments/order-fields";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm, type ApiForm } from "@/hooks/use-api-form";
import { afterInvestmentChange } from "@/lib/api/invalidate";
import { INVESTMENT_BROKER_IDS, INVESTMENT_BROKER_LABELS } from "@/lib/investments/types";
import { CURRENCY_OPTIONS } from "@/lib/utils/currency";

function InvestmentForm({
  id,
  form,
  onSuccess,
}: {
  id: string;
  form: ApiForm;
  onSuccess: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [instrument, setInstrument] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void form.submit(async () => {
      await submitInvestmentOrder(
        {
          brokerId: formData.get("brokerId"),
          instrument: formData.get("instrument"),
          currency: formData.get("currency"),
          side: "buy",
        },
        formData,
      );
      await afterInvestmentChange(mutate);
      onSuccess();
    }, { fallback: "The investment could not be saved." });
  }

  const instrumentCode = instrument.trim().toUpperCase();
  const instrumentHint = instrumentCode
    ? "The latest price will be requested from the configured price service."
    : "Use a listing code such as VWCE.DE or AAPL.US.";
  const { fieldError } = form;

  return (
    <form id={id} onSubmit={submit} aria-busy={form.pending}>
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
          <OrderFields
            fieldError={fieldError}
            amountLabel="Order amount"
            amountHint="Total order value in the selected currency."
          />
        </Stack>

        {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}

        <Text className="sr-only" role="status" aria-live="polite">
          {form.pending ? "Saving investment…" : ""}
        </Text>
      </Stack>
    </form>
  );
}

export function AddInvestmentDialog() {
  const [open, setOpen] = useState(false);
  const form = useApiForm();
  const formId = useId();

  return (
    <AppDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) form.reset();
      }}
      title="Add investment"
      description="The first recorded order creates the investment under its broker."
      trigger={
        <Button variant="solid" colorPalette="brand" size={{ base: "md", sm: "sm" }} flex={{ base: "1", sm: "initial" }}>
          <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add investment
        </Button>
      }
      footer={<FormActions form={formId} closesDialog pending={form.pending} submitLabel="Save investment" />}
    >
      <InvestmentForm id={formId} form={form} onSuccess={() => setOpen(false)} />
    </AppDialog>
  );
}
