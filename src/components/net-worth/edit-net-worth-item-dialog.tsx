"use client";

import {
  Alert,
  Button,
  Dialog,
  Field,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Archive, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { useSWRConfig } from "swr";

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
    <Dialog.Root open={open} onOpenChange={(details) => setOpen(details.open)} size="md">
      <Dialog.Trigger asChild>
        <Button type="button" minH="11" size="sm" variant="outline" borderRadius="xl">
          Edit details
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.500" backdropFilter="blur(4px)" />
        <Dialog.Positioner alignItems={{ base: "flex-end", sm: "center" }} p={{ base: "0", sm: "4" }} pb={{ base: "env(safe-area-inset-bottom)", sm: "4" }}>
          <Dialog.Content
            maxH={{ base: "calc(100dvh - env(safe-area-inset-top) - 1rem)", sm: "90dvh" }}
            borderRadius={{ base: "2xl 2xl 0 0", sm: "3xl" }}
            boxShadow="2xl"
            overflowY="auto"
          >
            <Dialog.Header>
              <Stack gap="1">
                <Dialog.Title>Edit {entry.name}</Dialog.Title>
                <Dialog.Description color="gray.500" fontSize="sm">
                  Keep the item in {entry.currency}; add a new dated value from its row when the balance changes.
                </Dialog.Description>
              </Stack>
            </Dialog.Header>
            <Dialog.Body>
              {open ? (
                <form onSubmit={save} aria-busy={pending || archiving}>
                  <Stack gap="4.5">
                    <Field.Root invalid={Boolean(fieldError("name"))}>
                      <Field.Label>Name</Field.Label>
                      <Input name="name" defaultValue={entry.name} autoFocus required borderRadius="xl" />
                      <Field.ErrorText>{fieldError("name")}</Field.ErrorText>
                    </Field.Root>

                    <Field.Root invalid={Boolean(fieldError("category"))}>
                      <Field.Label>Category</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field value={category} onChange={(event) => setCategory(event.target.value)} borderRadius="xl">
                          {suggestedCategories.map((value) => (
                            <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>
                          ))}
                          <option value="custom">Custom category</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                      <Field.ErrorText>{fieldError("category")}</Field.ErrorText>
                    </Field.Root>

                    {category === "custom" ? (
                      <Field.Root invalid={Boolean(fieldError("category"))}>
                        <Field.Label>Custom category</Field.Label>
                        <Input
                          value={customCategory}
                          onChange={(event) => setCustomCategory(event.target.value)}
                          required
                          borderRadius="xl"
                        />
                        <Field.ErrorText>{fieldError("category")}</Field.ErrorText>
                      </Field.Root>
                    ) : null}

                    {entry.kind === "asset" && category !== "cash" ? (
                      <Field.Root invalid={Boolean(fieldError("purchaseAmount"))}>
                        <Field.Label>Optional purchase amount</Field.Label>
                        <Input name="purchaseAmount" defaultValue={entry.purchaseAmount ?? ""} type="number" inputMode="decimal" min="0" step="any" placeholder="Leave blank if unknown" borderRadius="xl" />
                        <Field.HelperText>Comparison baseline only, not a tax-grade cost basis.</Field.HelperText>
                        <Field.ErrorText>{fieldError("purchaseAmount")}</Field.ErrorText>
                      </Field.Root>
                    ) : null}

                    {error ? (
                      <Alert.Root status="error" borderRadius="xl">
                        <Alert.Indicator />
                        <Alert.Description>{error}</Alert.Description>
                      </Alert.Root>
                    ) : null}

                    <Button type="submit" minH="11" colorPalette="purple" borderRadius="xl" loading={pending}>
                      Save changes
                    </Button>
                    <Button
                      type="button"
                      minH="11"
                      variant="ghost"
                      colorPalette="red"
                      borderRadius="xl"
                      loading={archiving}
                      onClick={() => void archive()}
                    >
                      <Archive size={16} aria-hidden="true" /> Archive item
                    </Button>
                    <Text color="gray.500" fontSize="xs">
                      Archiving hides this item from current totals but preserves its valuation history.
                    </Text>
                  </Stack>
                </form>
              ) : null}
            </Dialog.Body>
            <Dialog.CloseTrigger asChild>
              <Button variant="ghost" size="sm" borderRadius="lg" aria-label="Close dialog">
                <X size={17} aria-hidden="true" />
              </Button>
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
