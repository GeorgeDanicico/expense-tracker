"use client";

import { Alert, Button, Dialog, Portal, Stack, Text } from "@chakra-ui/react";
import { Trash2, TriangleAlert, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { useSWRConfig } from "swr";

import { apiRequest } from "@/lib/api/client";
import type { ExpensesData } from "@/lib/types";

export function DeleteExpenseButton({ id, description }: { id: string; description: string }) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    try {
      await apiRequest<{ success: true }>(`/api/expenses/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await mutate(
        (cacheKey) => typeof cacheKey === "string" && cacheKey.startsWith("/api/expenses?"),
        (current: ExpensesData | undefined) => {
          if (!current?.expenses.some((expense) => expense.id === id)) return current;
          const expenses = current.expenses.filter((expense) => expense.id !== id);
          const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);
          return { ...current, expenses, total, average: expenses.length ? total / expenses.length : 0 };
        },
        { revalidate: false },
      );
      void mutate(
        (cacheKey) => typeof cacheKey === "string" && cacheKey.startsWith("/api/dashboard?"),
        undefined,
        { revalidate: true },
      );
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete expense.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(details) => setOpen(details.open)} role="alertdialog" size="sm">
      <Dialog.Trigger asChild>
        <Button
          size="xs"
          variant="ghost"
          color="gray.400"
          borderRadius="lg"
          aria-label={`Delete ${description}`}
          _hover={{ color: "red.600", bg: "red.50" }}
        >
          <Trash2 size={15} aria-hidden="true" />
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.500" backdropFilter="blur(3px)" />
        <Dialog.Positioner p="4">
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
                <Dialog.Title>Delete this expense?</Dialog.Title>
              </Stack>
            </Dialog.Header>
            <Dialog.Body>
              <Dialog.Description color="gray.600">
                <Text as="span" fontWeight="700" color="gray.800">{description}</Text> will be permanently removed from your ledger.
              </Dialog.Description>
              {error ? (
                <Alert.Root mt="4" status="error" borderRadius="xl">
                  <Alert.Indicator />
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Root>
              ) : null}
            </Dialog.Body>
            <Dialog.Footer gap="3" pb="6">
              <Dialog.ActionTrigger asChild>
                <Button variant="outline" borderRadius="xl">Keep it</Button>
              </Dialog.ActionTrigger>
              <form onSubmit={submit}>
                <Button type="submit" colorPalette="red" borderRadius="xl" loading={pending}>
                  Delete expense
                </Button>
              </form>
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
