"use client";

import { Button, Input, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FormEvent, useId, useState } from "react";

import { NetWorthItemFields } from "@/components/net-worth/net-worth-item-fields";
import { useNetWorthWrites } from "@/components/net-worth/use-net-worth-writes";
import { AmountInput } from "@/components/ui/amount-input";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField, FormRow } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { getBucharestToday } from "@/lib/calendar";
import { purchaseAmountAllowed } from "@/lib/net-worth/rules";
import { netWorthCategoryOptions, type NetWorthItemKind } from "@/lib/net-worth/types";
import { CURRENCY_OPTIONS } from "@/lib/utils/currency";

export function AddNetWorthItemDialog({ defaultCurrency }: { defaultCurrency: string }) {
  const writes = useNetWorthWrites();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NetWorthItemKind>("asset");
  const [category, setCategory] = useState("cash");
  const [customCategory, setCustomCategory] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const form = useApiForm();
  const formId = useId();

  function resetForm() {
    setKind("asset");
    setCategory("cash");
    setCustomCategory("");
    setCurrency(defaultCurrency);
    form.reset();
  }

  function changeKind(nextKind: NetWorthItemKind) {
    setKind(nextKind);
    setCategory(nextKind === "liability" ? "debt" : "cash");
    setCustomCategory("");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const selectedCategory = category === "custom" ? customCategory : category;
    void form.submit(async () => {
      await writes.createItem({
        name: String(formData.get("name") ?? ""),
        kind,
        category: selectedCategory,
        currency: String(formData.get("currency") ?? ""),
        purchaseAmount: purchaseAmountAllowed(kind, category) ? String(formData.get("purchaseAmount") || "") || null : null,
        value: String(formData.get("value") ?? ""),
        valuedOn: String(formData.get("valuedOn") ?? ""),
      });
      setOpen(false);
    }, { fallback: "The item could not be saved." });
  }

  const { fieldError } = form;

  return (
    <AppDialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) resetForm();
      }}
      title="Add a net-worth item"
      description="Record one native-currency balance, estimate or debt. You can add another dated value later."
      trigger={
        <Button variant="solid" colorPalette="brand" size="sm">
          <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add item
        </Button>
      }
      footer={<FormActions form={formId} closesDialog pending={form.pending} submitLabel="Save item" />}
    >
      <form id={formId} onSubmit={submit} aria-busy={form.pending}>
        <Stack gap="3">
          <NetWorthItemFields
            kind={kind}
            category={category}
            onCategoryChange={setCategory}
            categoryOptions={netWorthCategoryOptions(kind)}
            customCategory={customCategory}
            onCustomCategoryChange={setCustomCategory}
            fieldError={fieldError}
            customCategoryHint="Use a short label; it will be normalized for grouping."
            kindField={
              <FormField flex="1" label="Type" error={fieldError("kind")}>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    name="kind"
                    value={kind}
                    onChange={(event) => changeKind(event.target.value as NetWorthItemKind)}
                  >
                    <option value="asset">Asset I own</option>
                    <option value="liability">Debt I owe</option>
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
            }
            beforePurchase={
              <FormField
                label="Currency"
                error={fieldError("currency")}
                hint="Net Worth keeps each currency separate; it does not convert values."
              >
                <NativeSelect.Root>
                  <NativeSelect.Field name="currency" value={currency} onChange={(event) => setCurrency(event.target.value)}>
                    {CURRENCY_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>{option.code} · {option.label}</option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
            }
          />

          <FormRow>
            <FormField flex="1" label={kind === "liability" ? "Current amount owed" : "Current value"} error={fieldError("value")}>
              <AmountInput name="value" currency={currency} required />
            </FormField>
            <FormField flex="1" label="Valued on" error={fieldError("valuedOn")}>
              <Input name="valuedOn" type="date" defaultValue={getBucharestToday()} required />
            </FormField>
          </FormRow>

          {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}

          <Text className="sr-only" role="status" aria-live="polite">
            {form.pending ? "Saving net-worth item…" : ""}
          </Text>
        </Stack>
      </form>
    </AppDialog>
  );
}
