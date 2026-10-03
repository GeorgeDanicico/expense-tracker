"use client";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  Field,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useSWRConfig } from "swr";

import { ApiError, apiRequest } from "@/lib/api/client";
import { EXPENSE_TABS_API_KEY, expenseTabApiKey } from "@/lib/api/keys";
import {
  CATEGORY_LABELS,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from "@/lib/types";
import {
  EXPENSE_SUBTYPES,
  SUBTYPE_CATEGORIES,
  SUBTYPE_LABELS,
  type ExpenseSubtype,
} from "@/lib/expenses/categories";
import type { ExpenseTab } from "@/lib/expenses/tabs";

type SavedTabResponse = { tab: ExpenseTab };
type TabsResponse = { tabs: ExpenseTab[] };

export function ExpenseTabDialog({
  open,
  onOpenChange,
  tab,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab?: ExpenseTab;
  onSaved: (tab: ExpenseTab) => void;
}) {
  const { mutate } = useSWRConfig();
  const [name, setName] = useState(tab?.name ?? "");
  const [categories, setCategories] = useState<ExpenseCategory[]>(tab?.categoryKeys ?? []);
  const [subtypes, setSubtypes] = useState<ExpenseSubtype[]>(tab?.subtypeKeys ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const editing = Boolean(tab);

  function toggleCategory(category: ExpenseCategory, checked: boolean) {
    setCategories((current) => checked
      ? [...current, category]
      : current.filter((value) => value !== category));
    if (checked) {
      setSubtypes((current) => current.filter((subtype) => SUBTYPE_CATEGORIES[subtype] !== category));
    }
  }

  function toggleSubtype(subtype: ExpenseSubtype, checked: boolean) {
    setSubtypes((current) => checked
      ? [...current, subtype]
      : current.filter((value) => value !== subtype));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setFieldErrors(undefined);
    const payload = {
      name: name.trim(),
      categoryKeys: EXPENSE_CATEGORIES.filter((category) => categories.includes(category)),
      subtypeKeys: EXPENSE_SUBTYPES.filter((subtype) => subtypes.includes(subtype)),
    };
    try {
      const result = await apiRequest<SavedTabResponse>(
        editing ? expenseTabApiKey(tab!.id) : EXPENSE_TABS_API_KEY,
        {
          method: editing ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      const saved = result.tab;
      await mutate(
        EXPENSE_TABS_API_KEY,
        (current: TabsResponse | undefined) => {
          const existing = current?.tabs ?? [];
          const tabs = editing
            ? existing.map((item) => item.id === saved.id ? saved : item)
            : [...existing.filter((item) => item.id !== saved.id), saved];
          return { tabs };
        },
        { revalidate: false },
      );
      if (editing) {
        void mutate((key) =>
          typeof key === "string" &&
          key.startsWith(`${expenseTabApiKey(saved.id)}/expenses?`),
        );
      }
      onSaved(saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to save this tab.");
      setFieldErrors(caught instanceof ApiError ? caught.fieldErrors : undefined);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(details) => onOpenChange(details.open)} size="lg">
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.500" />
        <Dialog.Positioner p="4">
          <Dialog.Content
            maxH="calc(var(--available-height, 100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)"
            overflowY="auto"
            borderRadius="2xl"
          >
            <Dialog.Header>
              <Stack gap="1">
                <Dialog.Title>{editing ? "Edit expense tab" : "Create expense tab"}</Dialog.Title>
                <Dialog.Description color="muted" fontSize="sm">
                  Choose the categories this tab should include. Your expenses stay in the main ledger.
                </Dialog.Description>
              </Stack>
            </Dialog.Header>
            <Dialog.Body>
              <form id="expense-tab-form" onSubmit={submit}>
                <Stack gap="5">
                  <Field.Root invalid={Boolean(fieldErrors?.name)}>
                    <Field.Label>Tab name</Field.Label>
                    <Input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      maxLength={80}
                      placeholder="e.g. Car"
                      autoFocus
                      required
                      borderRadius="xl"
                    />
                    <Field.ErrorText>{fieldErrors?.name?.[0]}</Field.ErrorText>
                  </Field.Root>

                  <Box>
                    <Text fontWeight="600">Included categories</Text>
                    <Text color="muted" fontSize="sm" mt="1">
                      Selecting a parent category includes all of its subtypes. To include only particular subtypes, leave the parent unchecked and choose those subtypes below.
                    </Text>
                    <Stack gap="3" mt="3">
                      {EXPENSE_CATEGORIES.map((category) => {
                        const categorySubtypes = EXPENSE_SUBTYPES.filter(
                          (subtype) => SUBTYPE_CATEGORIES[subtype] === category,
                        );
                        const parentSelected = categories.includes(category);
                        return (
                          <Stack key={category} gap="2" p="3" borderWidth="1px" borderColor="border" borderRadius="xl">
                            <Checkbox.Root
                              checked={parentSelected}
                              onCheckedChange={(details) => toggleCategory(category, details.checked === true)}
                            >
                              <Checkbox.HiddenInput />
                              <Checkbox.Control />
                              <Checkbox.Label fontWeight="600">
                                {CATEGORY_LABELS[category]}{categorySubtypes.length ? " — includes all subtypes" : ""}
                              </Checkbox.Label>
                            </Checkbox.Root>
                            {categorySubtypes.length ? (
                              <Stack pl="7" gap="2" aria-label={`${CATEGORY_LABELS[category]} subtypes`}>
                                {categorySubtypes.map((subtype) => (
                                  <Checkbox.Root
                                    key={subtype}
                                    checked={parentSelected || subtypes.includes(subtype)}
                                    disabled={parentSelected}
                                    onCheckedChange={(details) => toggleSubtype(subtype, details.checked === true)}
                                  >
                                    <Checkbox.HiddenInput />
                                    <Checkbox.Control />
                                    <Checkbox.Label>{SUBTYPE_LABELS[subtype]}</Checkbox.Label>
                                  </Checkbox.Root>
                                ))}
                                {parentSelected ? (
                                  <Text color="muted" fontSize="xs">
                                    Clear {CATEGORY_LABELS[category]} to choose individual subtypes.
                                  </Text>
                                ) : null}
                              </Stack>
                            ) : null}
                          </Stack>
                        );
                      })}
                    </Stack>
                    {fieldErrors?.categoryKeys?.[0] || fieldErrors?.subtypeKeys?.[0] ? (
                      <Text role="alert" color="error" fontSize="sm" mt="2">
                        {fieldErrors.categoryKeys?.[0] ?? fieldErrors.subtypeKeys?.[0]}
                      </Text>
                    ) : null}
                  </Box>

                  {error ? (
                    <Alert.Root status="error" borderRadius="xl">
                      <Alert.Indicator />
                      <Alert.Description>{error}</Alert.Description>
                    </Alert.Root>
                  ) : null}
                </Stack>
              </form>
            </Dialog.Body>
            <Dialog.Footer gap="3">
              <Dialog.CloseTrigger asChild>
                <Button variant="outline" borderRadius="xl" disabled={pending}>Cancel</Button>
              </Dialog.CloseTrigger>
              <Button
                type="submit"
                form="expense-tab-form"
                colorPalette="purple"
                borderRadius="xl"
                loading={pending}
              >
                {editing ? "Save changes" : "Create tab"}
              </Button>
            </Dialog.Footer>
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
