"use client";

import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react";
import { CircleCheck, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useSWRConfig } from "swr";

import { useImportApi } from "@/components/expenses/import/import-api";
import { UndoImportDialog } from "@/components/expenses/import/undo-dialog";
import { Card } from "@/components/ui/card";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { useApiForm } from "@/hooks/use-api-form";
import { afterImportChange } from "@/lib/api/invalidate";
import type { ImportConfirmResponse } from "@/lib/api/keys";
import { formatMonth } from "@/lib/calendar";
import { formatInstantDay } from "@/lib/imports/recent";
import { monthsOf, pluralize } from "@/lib/imports/review";
import { formatCurrency } from "@/lib/utils/currency";

/** The most month links the result shows; a long statement can touch many months. */
const MAX_MONTH_LINKS = 4;

/** "Added 34 expenses". */
export function addedHeading(count: number): string {
  return `Added ${pluralize(count, "expense")}`;
}

/** "Import undone" copy: how many expenses went. */
export function undoneDescription(removed: number): string {
  return `${pluralize(removed, "expense")} removed. Your expenses are as they were before the import.`;
}

/**
 * What the screen shows after Confirm: how many expenses were added (as stored), a link to the
 * month or months they fall in, and Undo, which removes exactly those expenses.
 */
export function ResultView({
  result,
  accountCurrency,
  onUploadAnother,
}: {
  result: ImportConfirmResponse;
  accountCurrency: string;
  onUploadAnother: () => void;
}) {
  const api = useImportApi();
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [removed, setRemoved] = useState<number | null>(null);
  const [undoing, setUndoing] = useState(false);
  const { created, batch } = result;
  const total = created.reduce((sum, expense) => sum + Math.round(expense.amount * 100), 0) / 100;
  const months = monthsOf(created);

  function undo() {
    void form.submit(async () => {
      const undone = await api.undo(batch.id);
      afterImportChange(mutate);
      setRemoved(undone.removed);
    }, { fallback: "The import could not be undone.", action: "undo" });
  }

  const now = new Date();

  if (removed !== null) {
    return (
      <Card>
        <Card.Body>
          <Stack gap="4" align="flex-start">
            <Stack gap="0.5">
              <Text as="h2" textStyle="sectionTitle">Import undone</Text>
              <Text textStyle="bodySm">{undoneDescription(removed)}</Text>
            </Stack>
            <Button variant="outline" onClick={onUploadAnother}>Upload a statement</Button>
          </Stack>
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Body>
        <Stack gap="4" align="flex-start">
          <Flex gap="3" align="flex-start">
            <Box color="fg.success" mt="0.5" aria-hidden="true">
              <CircleCheck size={ICON.nav} strokeWidth={ICON_STROKE} />
            </Box>
            <Stack gap="0.5">
              <Text as="h2" textStyle="sectionTitle" role="status">{addedHeading(created.length)}</Text>
              <Text textStyle="bodySm">
                {formatCurrency(total, accountCurrency)} in total, added to your expenses.
              </Text>
              <Text textStyle="caption">Changed your mind? Undo removes exactly these expenses.</Text>
            </Stack>
          </Flex>
          <Flex gap="2" wrap="wrap">
            {months.slice(0, MAX_MONTH_LINKS).map((month) => (
              <Button key={month} asChild variant="solid" colorPalette="brand" size="sm">
                <Link href={`/expenses?month=${month}`}>View {formatMonth(month)}</Link>
              </Button>
            ))}
            <Button
              variant="outline"
              size="sm"
              disabled={form.pending}
              onClick={() => {
                form.reset();
                setUndoing(true);
              }}
            >
              <Undo2 size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Undo
            </Button>
            <Button variant="ghost" size="sm" disabled={form.pending} onClick={onUploadAnother}>
              Import another statement
            </Button>
          </Flex>
        </Stack>
        <UndoImportDialog
          open={undoing}
          onOpenChange={(next) => {
            if (!form.pending) setUndoing(next);
          }}
          // Just imported: the expenses are the ones it created, none of them edited yet.
          counts={{ expenseCount: created.length, changedCount: 0 }}
          importedOn={formatInstantDay(batch.confirmedAt ?? now.toISOString(), { now, long: true })}
          pending={form.pendingAction === "undo"}
          error={form.error}
          onConfirm={undo}
        />
      </Card.Body>
    </Card>
  );
}
