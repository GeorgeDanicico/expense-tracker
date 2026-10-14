"use client";

import { Button, Flex, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FormEvent, useId, useState } from "react";
import { useSWRConfig } from "swr";

import { OrderFields, submitInvestmentOrder } from "@/components/investments/order-fields";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { useApiForm } from "@/hooks/use-api-form";
import { afterInvestmentChange } from "@/lib/api/invalidate";
import { investmentTransactionsApiKey } from "@/lib/api/keys";
import {
  INVESTMENT_BROKER_LABELS,
  type InvestmentBrokerId,
  type InvestmentOverviewAsset,
} from "@/lib/investments/types";

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
  const form = useApiForm();
  const formId = useId();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    void form.submit(async () => {
      await submitInvestmentOrder(
        {
          brokerId,
          instrument: asset.instrument,
          currency: asset.currency,
          side: formData.get("side"),
        },
        formData,
      );

      const detailKey = investmentTransactionsApiKey({
        accountId,
        instrument: asset.instrument,
        currency: asset.currency,
      });
      await afterInvestmentChange(mutate, detailKey);
      setOpen(false);
    }, { fallback: "The order could not be saved." });
  }

  const { fieldError } = form;

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
      footer={<FormActions form={formId} closesDialog pending={form.pending} submitLabel="Save order" />}
    >
      <form id={formId} onSubmit={submit} aria-busy={form.pending}>
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

          <OrderFields
            fieldError={fieldError}
            amountLabel={`Order amount (${asset.currency})`}
            amountHint="Total order value in the instrument currency."
          />

          {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}

          <Text className="sr-only" role="status" aria-live="polite">
            {form.pending ? "Saving order…" : ""}
          </Text>
        </Stack>
      </form>
    </AppDialog>
  );
}
