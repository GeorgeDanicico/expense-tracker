"use client";

import {
  Alert,
  Badge,
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
import { INVESTMENTS_API_KEY, investmentTransactionsApiKey } from "@/lib/api/keys";
import {
  INVESTMENT_BROKER_LABELS,
  type InvestmentBrokerId,
  type InvestmentOverviewAsset,
  type InvestmentTransactionMutationResponse,
} from "@/lib/investments/types";

function localDateTimeValue() {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

function formTimestamp(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return value;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
}

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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setFieldErrors(undefined);

    const formData = new FormData(event.currentTarget);
    try {
      await apiRequest<InvestmentTransactionMutationResponse>("/api/investment-transactions", {
        method: "POST",
        body: JSON.stringify({
          brokerId,
          instrument: asset.instrument,
          currency: asset.currency,
          side: formData.get("side"),
          amount: formData.get("amount"),
          quantity: formData.get("quantity"),
          unitPrice: formData.get("unitPrice"),
          executedAt: formTimestamp(formData.get("executedAt")),
        }),
      });

      const detailKey = investmentTransactionsApiKey({
        accountId,
        instrument: asset.instrument,
        currency: asset.currency,
      });
      await Promise.allSettled([mutate(INVESTMENTS_API_KEY), mutate(detailKey)]);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The order could not be saved.");
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
        <Button type="button" size="sm" colorPalette="purple" borderRadius="xl" minH="11">
          <Plus size={16} aria-hidden="true" /> Add order
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
                <Dialog.Title>Add an order</Dialog.Title>
                <Dialog.Description color="gray.500" fontSize="sm">
                  Record another buy or sell for this asset.
                </Dialog.Description>
              </Stack>
            </Dialog.Header>
            <Dialog.Body>
              {open ? (
                <form onSubmit={submit} aria-busy={pending}>
                  <Stack gap="4.5">
                    <Flex gap="2" wrap="wrap" align="center">
                      <Badge colorPalette="purple" variant="subtle" borderRadius="full" px="2.5" py="1">
                        {INVESTMENT_BROKER_LABELS[brokerId]}
                      </Badge>
                      <Text color="gray.600" fontSize="sm" fontWeight="700">{asset.instrument}</Text>
                      <Text color="gray.500" fontSize="sm">{asset.currency}</Text>
                    </Flex>

                    <Field.Root invalid={Boolean(fieldError("side"))}>
                      <Field.Label>Order side</Field.Label>
                      <NativeSelect.Root>
                        <NativeSelect.Field name="side" defaultValue="buy" autoFocus borderRadius="xl">
                          <option value="buy">Buy</option>
                          <option value="sell">Sell</option>
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                      <Field.HelperText>A sell is checked against units available at its execution time.</Field.HelperText>
                      <Field.ErrorText>{fieldError("side")}</Field.ErrorText>
                    </Field.Root>

                    <Flex gap="4" direction={{ base: "column", sm: "row" }}>
                      <Field.Root flex="1" invalid={Boolean(fieldError("quantity"))}>
                        <Field.Label>Quantity</Field.Label>
                        <Input name="quantity" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required borderRadius="xl" />
                        <Field.ErrorText>{fieldError("quantity")}</Field.ErrorText>
                      </Field.Root>
                      <Field.Root flex="1" invalid={Boolean(fieldError("unitPrice"))}>
                        <Field.Label>Unit price</Field.Label>
                        <Input name="unitPrice" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required borderRadius="xl" />
                        <Field.ErrorText>{fieldError("unitPrice")}</Field.ErrorText>
                      </Field.Root>
                    </Flex>

                    <Field.Root invalid={Boolean(fieldError("amount"))}>
                      <Field.Label>Order amount ({asset.currency})</Field.Label>
                      <Input name="amount" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required borderRadius="xl" />
                      <Field.HelperText>Total order value in the instrument currency.</Field.HelperText>
                      <Field.ErrorText>{fieldError("amount")}</Field.ErrorText>
                    </Field.Root>

                    <Field.Root invalid={Boolean(fieldError("executedAt"))}>
                      <Field.Label>Execution date and time</Field.Label>
                      <Input name="executedAt" type="datetime-local" defaultValue={localDateTimeValue()} required borderRadius="xl" />
                      <Field.ErrorText>{fieldError("executedAt")}</Field.ErrorText>
                    </Field.Root>

                    {error ? (
                      <Alert.Root status="error" borderRadius="xl">
                        <Alert.Indicator />
                        <Alert.Description>{error}</Alert.Description>
                      </Alert.Root>
                    ) : null}

                    <Text className="sr-only" role="status" aria-live="polite">
                      {pending ? "Saving order…" : ""}
                    </Text>
                    <Button type="submit" minH="11" colorPalette="purple" borderRadius="xl" loading={pending}>
                      Save order
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
