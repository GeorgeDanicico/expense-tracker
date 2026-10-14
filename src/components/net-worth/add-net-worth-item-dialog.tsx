"use client";

import { Button, Input, NativeSelect, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { FormEvent, useId, useState } from "react";
import { useSWRConfig } from "swr";

import { NetWorthItemFields } from "@/components/net-worth/net-worth-item-fields";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField, FormRow } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { ApiError, apiRequest } from "@/lib/api/client";
import { NET_WORTH_API_KEY } from "@/lib/api/keys";
import { getUtcToday } from "@/lib/calendar";
import { purchaseAmountAllowed } from "@/lib/net-worth/rules";
import { type NetWorthItemKind } from "@/lib/net-worth/types";
import { CURRENCY_OPTIONS } from "@/lib/utils/currency";

function categoryOptions(kind: NetWorthItemKind) {
  return kind === "liability"
    ? [
        { value: "debt", label: "Debt or mortgage" },
        { value: "custom", label: "Custom category" },
      ]
    : [
        { value: "cash", label: "Cash" },
        { value: "property", label: "Property" },
        { value: "jewelry", label: "Jewelry" },
        { value: "custom", label: "Custom category" },
      ];
}

export function AddNetWorthItemDialog({
  defaultCurrency,
  onSuccess,
}: {
  defaultCurrency: string;
  onSuccess: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NetWorthItemKind>("asset");
  const [category, setCategory] = useState("cash");
  const [customCategory, setCustomCategory] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const formId = useId();

  function resetForm() {
    setKind("asset");
    setCategory("cash");
    setCustomCategory("");
    setError("");
    setFieldErrors(undefined);
  }

  function changeKind(nextKind: NetWorthItemKind) {
    setKind(nextKind);
    setCategory(nextKind === "liability" ? "debt" : "cash");
    setCustomCategory("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const formData = new FormData(event.currentTarget);
    const selectedCategory = category === "custom" ? customCategory : category;
    setPending(true);
    setError("");
    setFieldErrors(undefined);

    try {
      await apiRequest<{ itemId: string }>("/api/net-worth/items", {
        method: "POST",
        body: JSON.stringify({
          name: formData.get("name"),
          kind,
          category: selectedCategory,
          currency: formData.get("currency"),
          purchaseAmount: purchaseAmountAllowed(kind, category)
            ? formData.get("purchaseAmount") || null
            : null,
          value: formData.get("value"),
          valuedOn: formData.get("valuedOn"),
        }),
      });
      await mutate(NET_WORTH_API_KEY);
      setOpen(false);
      onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The item could not be saved.");
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
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) resetForm();
      }}
      title="Add a net-worth item"
      description="Record one native-currency balance, estimate or debt. You can add another dated value later."
      trigger={
        <Button variant="solid" colorPalette="brand" size={{ base: "md", sm: "sm" }} flex={{ base: "1", sm: "initial" }}>
          <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add item
        </Button>
      }
      footer={<FormActions form={formId} closesDialog pending={pending} submitLabel="Save item" />}
    >
      <form id={formId} onSubmit={submit} aria-busy={pending}>
        <Stack gap="3">
          <NetWorthItemFields
            kind={kind}
            category={category}
            onCategoryChange={setCategory}
            categoryOptions={categoryOptions(kind)}
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
                  <NativeSelect.Field name="currency" defaultValue={defaultCurrency}>
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
              <Input name="value" type="number" inputMode="decimal" min="0" step="any" placeholder="0.00" required />
            </FormField>
            <FormField flex="1" label="Valued on" error={fieldError("valuedOn")}>
              <Input name="valuedOn" type="date" defaultValue={getUtcToday()} required />
            </FormField>
          </FormRow>

          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}

          <Text className="sr-only" role="status" aria-live="polite">
            {pending ? "Saving net-worth item…" : ""}
          </Text>
        </Stack>
      </form>
    </AppDialog>
  );
}
