"use client";

import {
  Alert,
  Button,
  Dialog,
  Field,
  Flex,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { useSWRConfig } from "swr";

import { ApiError, apiRequest } from "@/lib/api/client";
import { NET_WORTH_API_KEY } from "@/lib/api/keys";
import { type NetWorthItemKind } from "@/lib/net-worth/types";
import { CURRENCY_OPTIONS } from "@/lib/utils/currency";

function currentDateValue() {
  return new Date().toISOString().slice(0, 10);
}

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
          purchaseAmount: kind === "asset" && category !== "cash"
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
    <Dialog.Root
      open={open}
      onOpenChange={(details) => {
        setOpen(details.open);
        if (details.open) resetForm();
      }}
      size="md"
    >
      <Dialog.Trigger asChild>
        <Button width={{ base: "full", sm: "auto" }} minH="11" colorPalette="purple" borderRadius="xl" boxShadow="0 8px 18px rgb(124 58 237 / 16%)">
          <Plus size={17} aria-hidden="true" /> Add item
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
                <Dialog.Title>Add a net-worth item</Dialog.Title>
                <Dialog.Description color="gray.500" fontSize="sm">
                  Record one native-currency balance, estimate or debt. You can add another dated value later.
                </Dialog.Description>
              </Stack>
            </Dialog.Header>
            <Dialog.Body>
              {open ? (
                <form onSubmit={submit} aria-busy={pending}>
                  <Stack gap="4.5">
                    <Field.Root invalid={Boolean(fieldError("name"))}>
                      <Field.Label>Name</Field.Label>
                      <Input name="name" autoFocus placeholder="e.g. BCR current account" required borderRadius="xl" />
                      <Field.ErrorText>{fieldError("name")}</Field.ErrorText>
                    </Field.Root>

                    <Flex gap="4" direction={{ base: "column", sm: "row" }}>
                      <Field.Root flex="1" invalid={Boolean(fieldError("kind"))}>
                        <Field.Label>Type</Field.Label>
                        <NativeSelect.Root>
                          <NativeSelect.Field
                            name="kind"
                            value={kind}
                            onChange={(event) => changeKind(event.target.value as NetWorthItemKind)}
                            borderRadius="xl"
                          >
                            <option value="asset">Asset I own</option>
                            <option value="liability">Debt I owe</option>
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                        <Field.ErrorText>{fieldError("kind")}</Field.ErrorText>
                      </Field.Root>

                      <Field.Root flex="1" invalid={Boolean(fieldError("category"))}>
                        <Field.Label>Category</Field.Label>
                        <NativeSelect.Root>
                          <NativeSelect.Field
                            name="category"
                            value={category}
                            onChange={(event) => setCategory(event.target.value)}
                            borderRadius="xl"
                          >
                            {categoryOptions(kind).map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </NativeSelect.Field>
                          <NativeSelect.Indicator />
                        </NativeSelect.Root>
                        <Field.ErrorText>{fieldError("category")}</Field.ErrorText>
                      </Field.Root>
                    </Flex>

                    {category === "custom" ? (
                      <Field.Root invalid={Boolean(fieldError("category"))}>
                        <Field.Label>Custom category</Field.Label>
                        <Input
                          value={customCategory}
                          onChange={(event) => setCustomCategory(event.target.value)}
                          placeholder="e.g. Collectibles"
                          required
                          borderRadius="xl"
                        />
                        <Field.HelperText>Use a short label; it will be normalized for grouping.</Field.HelperText>
                        <Field.ErrorText>{fieldError("category")}</Field.ErrorText>
                      </Field.Root>
                    ) : null}

                    <Field.Root invalid={Boolean(fieldError("currency"))}>
                      <Field.Label>Currency</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field name="currency" defaultValue={defaultCurrency} borderRadius="xl">
                          {CURRENCY_OPTIONS.map((option) => (
                            <option key={option.code} value={option.code}>{option.code} · {option.label}</option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                      <Field.HelperText>Net Worth keeps each currency separate; it does not convert values.</Field.HelperText>
                      <Field.ErrorText>{fieldError("currency")}</Field.ErrorText>
                    </Field.Root>

                    {kind === "asset" && category !== "cash" ? (
                      <Field.Root invalid={Boolean(fieldError("purchaseAmount"))}>
                        <Field.Label>Optional purchase amount</Field.Label>
                        <Input name="purchaseAmount" type="number" inputMode="decimal" min="0" step="any" placeholder="Leave blank if unknown" borderRadius="xl" />
                        <Field.HelperText>Comparison baseline only, not a tax-grade cost basis.</Field.HelperText>
                        <Field.ErrorText>{fieldError("purchaseAmount")}</Field.ErrorText>
                      </Field.Root>
                    ) : null}

                    <Flex gap="4" direction={{ base: "column", sm: "row" }}>
                      <Field.Root flex="1" invalid={Boolean(fieldError("value"))}>
                        <Field.Label>{kind === "liability" ? "Current amount owed" : "Current value"}</Field.Label>
                        <Input name="value" type="number" inputMode="decimal" min="0" step="any" placeholder="0.00" required borderRadius="xl" />
                        <Field.ErrorText>{fieldError("value")}</Field.ErrorText>
                      </Field.Root>
                      <Field.Root flex="1" invalid={Boolean(fieldError("valuedOn"))}>
                        <Field.Label>Valued on</Field.Label>
                        <Input name="valuedOn" type="date" defaultValue={currentDateValue()} required borderRadius="xl" />
                        <Field.ErrorText>{fieldError("valuedOn")}</Field.ErrorText>
                      </Field.Root>
                    </Flex>

                    {error ? (
                      <Alert.Root status="error" borderRadius="xl">
                        <Alert.Indicator />
                        <Alert.Description>{error}</Alert.Description>
                      </Alert.Root>
                    ) : null}

                    <Text className="sr-only" role="status" aria-live="polite">
                      {pending ? "Saving net-worth item…" : ""}
                    </Text>
                    <Button type="submit" minH="11" colorPalette="purple" borderRadius="xl" loading={pending}>
                      Save item
                    </Button>
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
