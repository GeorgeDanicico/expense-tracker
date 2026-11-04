"use client";

import { Button, Stack, Text } from "@chakra-ui/react";
import { Archive } from "lucide-react";
import { FormEvent, useId, useState } from "react";

import { NetWorthItemFields } from "@/components/net-worth/net-worth-item-fields";
import { useNetWorthWrites } from "@/components/net-worth/use-net-worth-writes";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { purchaseAmountAllowed } from "@/lib/net-worth/rules";
import { NET_WORTH_CATEGORIES, netWorthCategoryOptions, type NetWorthEntry } from "@/lib/net-worth/types";

function initialCategory(entry: NetWorthEntry) {
  const known = NET_WORTH_CATEGORIES.some((category) => category.key === entry.category && category.kind === entry.kind && !("automatic" in category));
  return known ? entry.category : "custom";
}

/** An item's name, category and purchase amount, and Archive, in a sheet opened from its row's actions. */
export function EditNetWorthItemDialog({
  entry,
  open,
  onOpenChange,
}: {
  entry: NetWorthEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const writes = useNetWorthWrites();
  const [category, setCategory] = useState(initialCategory(entry));
  const [customCategory, setCustomCategory] = useState(entry.category);
  const form = useApiForm();
  const formId = useId();

  if (entry.itemId === null) return null;
  const itemId = entry.itemId;
  const saving = form.pendingAction === "save";
  const archiving = form.pendingAction === "archive";

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const selectedCategory = category === "custom" ? customCategory : category;
    void form.submit(async () => {
      await writes.updateItem(itemId, {
        name: String(formData.get("name") ?? ""),
        category: selectedCategory,
        purchaseAmount: purchaseAmountAllowed(entry.kind, category) ? String(formData.get("purchaseAmount") || "") || null : null,
      });
      onOpenChange(false);
    }, { fallback: "The item could not be updated.", action: "save" });
  }

  function archive() {
    void form.submit(async () => {
      await writes.updateItem(itemId, { archived: true });
      onOpenChange(false);
    }, { fallback: "The item could not be archived.", action: "archive" });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${entry.name}`}
      description={`Keep the item in ${entry.currency}; add a new dated value from its row when the balance changes.`}
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
            categoryOptions={netWorthCategoryOptions(entry.kind)}
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
