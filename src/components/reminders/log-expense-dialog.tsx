"use client";

import { Box, Button, Flex, Input, Stack, Text } from "@chakra-ui/react";
import { Receipt } from "lucide-react";
import { useState } from "react";

import { AppDialog } from "@/components/ui/app-dialog";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { expenseClassificationLabel } from "@/lib/expenses/categories";
import { formatDay } from "@/lib/reminders/format";
import type { ListedReminder } from "@/lib/reminders/list";
import type { ExpenseTemplate } from "@/lib/reminders/types";

/** The amount typed in the confirm, or null while it isn't a positive number. */
export function confirmAmount(value: string): number | null {
  const amount = Number(value.trim());
  return value.trim() !== "" && Number.isFinite(amount) && amount > 0 ? amount : null;
}

function Detail({ label, children }: { label: string; children: string }) {
  return (
    <Flex justify="space-between" gap="3" textStyle="bodySm">
      <Text as="span" color="fg.muted">{label}</Text>
      <Text as="span" fontWeight="medium" textAlign="end" minW="0" wordBreak="break-word">{children}</Text>
    </Flex>
  );
}

/**
 * "Mark done" on a reminder with an expense template (R12): the expense pre-filled for the open
 * occurrence (the reminder's title, the template's amount, category and subtype, dated on the
 * occurrence), with the amount editable. "Log expense and mark done" waits for the server and
 * stays open with its answer when it refuses; "Just mark done" marks it done without the expense.
 * A template saved in another currency than the account's can't be logged until it's edited.
 * The two answers stack, primary on top, on a phone and sit side by side from `sm`; there's no
 * Cancel button, as the close button and Escape cancel.
 */
export function LogExpenseDialog({
  reminder,
  template,
  occurrenceOn,
  currency,
  open,
  onOpenChange,
  onLog,
  onJustDone,
  now = new Date(),
}: {
  reminder: Pick<ListedReminder, "id" | "title">;
  template: ExpenseTemplate;
  /** The open occurrence being marked done: the expense's date. */
  occurrenceOn: string;
  /** The account's currency, which expenses are kept in. */
  currency: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLog: (amount: number) => Promise<unknown>;
  onJustDone: () => void;
  now?: Date;
}) {
  const form = useApiForm();
  const [amount, setAmount] = useState(String(template.amount));
  const formId = `log-expense-${reminder.id}`;
  const parsed = confirmAmount(amount);
  const wrongCurrency = template.currency !== currency;

  function log() {
    if (parsed === null) return;
    void form.submit(async () => {
      await onLog(parsed);
      onOpenChange(false);
    }, { fallback: "The expense could not be logged." });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(value) => {
        if (!form.pending) onOpenChange(value);
      }}
      size="sm"
      title="Log the expense?"
      description={`${reminder.title} · due ${formatDay(occurrenceOn, now)}`}
      footer={(
        <Flex direction={{ base: "column", sm: "row-reverse" }} gap="2" width="full" justify={{ sm: "flex-start" }}>
          <Button
            type="submit"
            form={formId}
            variant="solid"
            colorPalette="brand"
            size={{ base: "md", sm: "sm" }}
            loading={form.pending}
            disabled={parsed === null || wrongCurrency}
          >
            Log expense and mark done
          </Button>
          <Button
            variant="outline"
            size={{ base: "md", sm: "sm" }}
            disabled={form.pending}
            onClick={() => {
              onOpenChange(false);
              onJustDone();
            }}
          >
            Just mark done
          </Button>
        </Flex>
      )}
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          log();
        }}
      >
        <Stack gap="3">
          <Flex align="center" gap="3" p="3" borderRadius="l2" bg="bg.subtle">
            <Flex flexShrink="0" boxSize="8" align="center" justify="center" borderRadius="full" bg="brand.muted" color="brand.fg" aria-hidden="true">
              <Receipt size={ICON.sm} strokeWidth={ICON_STROKE} />
            </Flex>
            <Stack gap="1" flex="1" minW="0">
              <Detail label="Description">{reminder.title.slice(0, 120)}</Detail>
              <Detail label="Category">{expenseClassificationLabel(template.category, template.subtype)}</Detail>
              <Detail label="Date">{formatDay(occurrenceOn, now)}</Detail>
            </Stack>
          </Flex>
          <FormField
            label={`Amount (${template.currency})`}
            error={form.fieldError("amount") ?? (amount.trim() !== "" && parsed === null ? "Amount must be greater than zero." : undefined)}
          >
            <Input
              name="amount"
              type="number"
              inputMode="decimal"
              min="0.01"
              max="9999999999.99"
              step="0.01"
              required
              value={amount}
              disabled={wrongCurrency}
              onChange={(event) => setAmount(event.target.value)}
            />
          </FormField>
          {wrongCurrency ? (
            <InlineAlert status="warning">
              {`This expense is in ${template.currency}, but your expenses are in ${currency}. Edit the reminder's expense to log it, or just mark it done.`}
            </InlineAlert>
          ) : (
            <Box>
              <Text textStyle="caption">It’s added to your expenses and linked from the Done tab.</Text>
            </Box>
          )}
          {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
        </Stack>
      </form>
    </AppDialog>
  );
}
