"use client";

import { Alert, Box, Button, Dialog, Portal, Stack, Text } from "@chakra-ui/react";
import { Trash2, TriangleAlert, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { useSWRConfig } from "swr";

import { ApiError, apiRequest } from "@/lib/api/client";
import { INVESTMENTS_API_KEY, investmentTransactionsApiKey } from "@/lib/api/keys";
import type { InvestmentTransactionDto } from "@/lib/investments/types";
import { formatInvestmentAmount } from "@/lib/utils/currency";
import { formatDateTime } from "@/lib/utils/dates";

export function RemoveOrderDialog({
  accountId,
  instrument,
  currency,
  transaction,
  onDeleted,
}: {
  accountId: string;
  instrument: string;
  currency: string;
  transaction: InvestmentTransactionDto;
  onDeleted: () => void;
}) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");

    try {
      await apiRequest<Record<string, never>>(`/api/investment-transactions/${encodeURIComponent(transaction.id)}`, {
        method: "DELETE",
      });

      const detailKey = investmentTransactionsApiKey({ accountId, instrument, currency });
      await Promise.allSettled([mutate(INVESTMENTS_API_KEY), mutate(detailKey)]);
      setOpen(false);
      onDeleted();
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : "Unable to remove this order.");
    } finally {
      setPending(false);
    }
  }

  const side = transaction.side === "buy" ? "Buy" : "Sell";

  return (
    <Dialog.Root open={open} onOpenChange={(details) => setOpen(details.open)} role="alertdialog" size="sm">
      <Dialog.Trigger asChild>
        <Button
          type="button"
          size="sm"
          minH="11"
          variant="ghost"
          color="gray.400"
          borderRadius="lg"
          aria-label={`Remove ${side.toLowerCase()} order for ${instrument}`}
          _hover={{ color: "red.600", bg: "red.50" }}
        >
          <Trash2 size={15} aria-hidden="true" /> Remove
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.500" backdropFilter="blur(3px)" />
        <Dialog.Positioner p="4" pb={{ base: "calc(1rem + env(safe-area-inset-bottom))", sm: "4" }}>
          <Dialog.Content borderRadius="2xl" boxShadow="2xl">
            <Dialog.Header pt="6">
              <Stack gap="3">
                <Button
                  as="div"
                  width="11"
                  height="11"
                  p="0"
                  color="red.600"
                  bg="red.50"
                  borderRadius="xl"
                  pointerEvents="none"
                >
                  <TriangleAlert size={21} aria-hidden="true" />
                </Button>
                <Dialog.Title>Remove this order?</Dialog.Title>
              </Stack>
            </Dialog.Header>
            <Dialog.Body>
              <Dialog.Description color="gray.600">
                This permanently removes the recorded order. Totals and cost basis will be recalculated from the remaining history.
              </Dialog.Description>
              <Stack mt="4" gap="1" p="4" borderRadius="xl" bg="gray.50">
                <Text color="gray.900" fontWeight="800">{side} · {instrument}</Text>
                <Text color="gray.600" fontSize="sm">{transaction.quantity} units · {formatInvestmentAmount(transaction.amount, currency)}</Text>
                <Text color="gray.500" fontSize="sm">Executed {formatDateTime(transaction.executedAt)}</Text>
              </Stack>
              {error ? (
                <Alert.Root mt="4" status="error" borderRadius="xl">
                  <Alert.Indicator />
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Root>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer gap="3" pb="6" direction={{ base: "column-reverse", sm: "row" }}>
              <Dialog.ActionTrigger asChild>
                <Button width={{ base: "full", sm: "auto" }} minH="11" variant="outline" borderRadius="xl">Keep order</Button>
              </Dialog.ActionTrigger>
              <Box
                as="form"
                onSubmit={(event) => submit(event as unknown as FormEvent<HTMLFormElement>)}
                width={{ base: "full", sm: "auto" }}
              >
                <Button width={{ base: "full", sm: "auto" }} minH="11" type="submit" colorPalette="red" borderRadius="xl" loading={pending}>
                  Remove order
                </Button>
              </Box>
              <Text className="sr-only" role="status" aria-live="polite">
                {pending ? "Removing order…" : ""}
              </Text>
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
