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
import { ApiError, apiRequest } from "@/lib/api/client";
import { NET_WORTH_API_KEY } from "@/lib/api/keys";
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
  const [pending, setPending] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const formId = useId();

  if (entry.itemId === null) return null;
  const itemId = entry.itemId;

  const suggestedCategories = entry.kind === "liability"
    ? ["debt"]
    : ["cash", "property", "jewelry"];

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || archiving) return;

    const formData = new FormData(event.currentTarget);
    const selectedCategory = category === "custom" ? customCategory : category;
    setPending(true);
    setError("");
    setFieldErrors(undefined);

    try {
      await apiRequest<{ success: true }>(`/api/net-worth/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: formData.get("name"),
          category: selectedCategory,
          purchaseAmount: entry.kind === "asset" && category !== "cash"
            ? formData.get("purchaseAmount") || null
            : null,
        }),
      });
      await mutate(NET_WORTH_API_KEY);
      setOpen(false);
      onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The item could not be updated.");
      setFieldErrors(caught instanceof ApiError ? caught.fieldErrors : undefined);
    } finally {
      setPending(false);
    }
  }

  async function archive() {
    if (pending || archiving) return;
    setArchiving(true);
    setError("");
    setFieldErrors(undefined);

    try {
      await apiRequest<{ success: true }>(`/api/net-worth/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      await mutate(NET_WORTH_API_KEY);
      setOpen(false);
      onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The item could not be archived.");
      setFieldErrors(caught instanceof ApiError ? caught.fieldErrors : undefined);
    } finally {
      setArchiving(false);
    }
  }

  function fieldError(name: string) {
    return fieldErrors?.[name]?.[0];
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
          pending={pending}
          disabled={archiving}
          submitLabel="Save changes"
          leading={
            <Button
              type="button"
              variant="ghost"
              colorPalette="danger"
              size={{ base: "md", sm: "sm" }}
              loading={archiving}
              disabled={pending}
              onClick={() => void archive()}
            >
              <Archive size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Archive item
            </Button>
          }
        />
      }
    >
      <form id={formId} onSubmit={save} aria-busy={pending || archiving}>
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
            fieldError={fieldError}
            defaultName={entry.name}
            defaultPurchaseAmount={entry.purchaseAmount ?? ""}
          />

          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}

          <Text textStyle="caption">
            Archiving hides this item from current totals but preserves its valuation history.
          </Text>
        </Stack>
      </form>
    </AppDialog>
  );
}
