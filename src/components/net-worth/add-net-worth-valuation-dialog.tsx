"use client";

import {
  Alert,
  Button,
  Dialog,
  Field,
  Flex,
  Input,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { useSWRConfig } from "swr";

import { ApiError, apiRequest } from "@/lib/api/client";
import { NET_WORTH_API_KEY } from "@/lib/api/keys";
import type { NetWorthEntry } from "@/lib/net-worth/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";
import { formatDate } from "@/lib/utils/dates";

function currentDateValue() {
  return new Date().toISOString().slice(0, 10);
}

export function AddNetWorthValuationDialog({
  entry,
  onSuccess,
}: {
  entry: NetWorthEntry;
  onSuccess: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  if (entry.itemId === null) return null;
  const itemId = entry.itemId;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const formData = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    setFieldErrors(undefined);

    try {
      await apiRequest<{ valuation: unknown }>(`/api/net-worth/items/${encodeURIComponent(itemId)}/valuations`, {
        method: "POST",
        body: JSON.stringify({
          value: formData.get("value"),
          valuedOn: formData.get("valuedOn"),
        }),
      });
      await mutate(NET_WORTH_API_KEY);
      setOpen(false);
      onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The value could not be saved.");
      setFieldErrors(caught instanceof ApiError ? caught.fieldErrors : undefined);
    } finally {
      setPending(false);
    }
  }

  function fieldError(name: string) {
    return fieldErrors?.[name]?.[0];
  }

  return (
    <Dialog.Root open={open} onOpenChange={(details) => setOpen(details.open)} size="md">
      <Dialog.Trigger asChild>
        <Button type="button" minH="11" size="sm" colorPalette="purple" borderRadius="xl">
          <Plus size={16} aria-hidden="true" /> Add value
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.500" backdropFilter="blur(4px)" />
        <Dialog.Positioner alignItems={{ base: "flex-end", sm: "center" }} p={{ base: "0", sm: "4" }} pb={{ base: "env(safe-area-inset-bottom)", sm: "4" }}>
          <Dialog.Content borderRadius={{ base: "2xl 2xl 0 0", sm: "3xl" }} boxShadow="2xl">
            <Dialog.Header>
              <Stack gap="1">
                <Dialog.Title>Add a dated value</Dialog.Title>
                <Dialog.Description color="gray.500" fontSize="sm">
                  Correcting the same date replaces its observation instead of creating a duplicate.
                </Dialog.Description>
              </Stack>
            </Dialog.Header>
            <Dialog.Body>
              {open ? (
                <form onSubmit={submit} aria-busy={pending}>
                  <Stack gap="4.5">
                    <Flex align="center" justify="space-between" gap="3" p="4" borderRadius="xl" bg="gray.50">
                      <Stack minW="0" gap="1">
                        <Text color="gray.900" fontWeight="750" truncate>{entry.name}</Text>
                        <Text color="gray.500" fontSize="sm">{entry.currency} · {entry.kind === "liability" ? "amount owed" : "owned value"}</Text>
                      </Stack>
                      <Text color="gray.900" fontWeight="800" whiteSpace="nowrap">
                        {entry.currentValue === null ? "No value" : formatInvestmentAmount(entry.currentValue, entry.currency)}
                      </Text>
                    </Flex>

                    <Field.Root invalid={Boolean(fieldError("value"))}>
                      <Field.Label>{entry.kind === "liability" ? "Amount owed" : "Current value"}</Field.Label>
                      <Input name="value" defaultValue={entry.currentValue ?? ""} type="number" inputMode="decimal" min="0" step="any" autoFocus required borderRadius="xl" />
                      <Field.ErrorText>{fieldError("value")}</Field.ErrorText>
                    </Field.Root>

                    <Field.Root invalid={Boolean(fieldError("valuedOn"))}>
                      <Field.Label>Valued on</Field.Label>
                      <Input name="valuedOn" defaultValue={entry.valuedOn ?? currentDateValue()} type="date" required borderRadius="xl" />
                      <Field.HelperText>{entry.valuedOn ? `Latest observation: ${formatDate(entry.valuedOn)}` : "Use the date you observed or estimated this value."}</Field.HelperText>
                      <Field.ErrorText>{fieldError("valuedOn")}</Field.ErrorText>
                    </Field.Root>

                    {error ? (
                      <Alert.Root status="error" borderRadius="xl">
                        <Alert.Indicator />
                        <Alert.Description>{error}</Alert.Description>
                      </Alert.Root>
                    ) : null}

                    <Button type="submit" minH="11" colorPalette="purple" borderRadius="xl" loading={pending}>
                      Save value
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
