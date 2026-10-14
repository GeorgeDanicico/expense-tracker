"use client";

import { Button, Stack, Text } from "@chakra-ui/react";
import { Archive } from "lucide-react";
import { FormEvent, useId, useState } from "react";
import { useSWRConfig } from "swr";

import { NetWorthItemFields } from "@/components/net-worth/net-worth-item-fields";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterNetWorthChange } from "@/lib/api/invalidate";
import { purchaseAmountAllowed } from "@/lib/net-worth/rules";
import { NET_WORTH_SUGGESTED_CATEGORIES, type NetWorthEntry } from "@/lib/net-worth/types";

function initialCategory(entry: NetWorthEntry) {
  return NET_WORTH_SUGGESTED_CATEGORIES.includes(entry.category as (typeof NET_WORTH_SUGGESTED_CATEGORIES)[number])
    ? entry.category
    : "custom";
}

export function EditNetWorthItemDialog({
  entry,
  onSuccess,
}: {
  entry: NetWorthEntry;
  onSuccess: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(initialCategory(entry));
  const [customCategory, setCustomCategory] = useState(entry.category);
  const form = useApiForm();
  const formId = useId();

  if (entry.itemId === null) return null;
  const itemId = entry.itemId;
  const saving = form.pendingAction === "save";
  const archiving = form.pendingAction === "archive";

  const suggestedCategories = entry.kind === "liability"
    ? ["debt"]
    : ["cash", "property", "jewelry"];

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const selectedCategory = category === "custom" ? customCategory : category;
    void form.submit(async () => {
      await apiRequest<{ success: true }>(`/api/net-worth/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: formData.get("name"),
          category: selectedCategory,
          purchaseAmount: purchaseAmountAllowed(entry.kind, category)
            ? formData.get("purchaseAmount") || null
            : null,
        }),
      });
      await afterNetWorthChange(mutate);
      setOpen(false);
      onSuccess();
    }, { fallback: "The item could not be updated.", action: "save" });
  }

  function archive() {
    void form.submit(async () => {
      await apiRequest<{ success: true }>(`/api/net-worth/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      await afterNetWorthChange(mutate);
      setOpen(false);
      onSuccess();
    }, { fallback: "The item could not be archived.", action: "archive" });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={setOpen}
      title={`Edit ${entry.name}`}
      description={`Keep the item in ${entry.currency}; add a new dated value from its row when the balance changes.`}
      trigger={<Button type="button" size="xs" variant="ghost">Edit details</Button>}
      footer={
        <FormActions
          form={formId}
          closesDialog
          pending={saving}
          disabled={archiving}
          submitLabel="Save changes"
          leading={
            <Button
              type="button"
              variant="ghost"
              colorPalette="danger"
              size={{ base: "md", sm: "sm" }}
              loading={archiving}
              disabled={saving}
              onClick={archive}
            >
              <Archive size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Archive item
            </Button>
          }
        />
      }
    >
      <form id={formId} onSubmit={save} aria-busy={form.pending}>
        <Stack gap="3">
          <NetWorthItemFields
            kind={entry.kind}
            category={category}
            onCategoryChange={setCategory}
            categoryOptions={[
              ...suggestedCategories.map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
              { value: "custom", label: "Custom category" },
            ]}
            customCategory={customCategory}
            onCustomCategoryChange={setCustomCategory}
            fieldError={form.fieldError}
            defaultName={entry.name}
            defaultPurchaseAmount={entry.purchaseAmount ?? ""}
          />

          {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}

          <Text textStyle="caption">
            Archiving hides this item from current totals but preserves its valuation history.
          </Text>
        </Stack>
      </form>
    </AppDialog>
  );
}
