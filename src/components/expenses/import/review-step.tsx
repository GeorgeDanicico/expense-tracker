"use client";

import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react";
import { useReducer, useState } from "react";
import { useSWRConfig } from "swr";

import { useImportApi } from "@/components/expenses/import/import-api";
import { ReviewCards } from "@/components/expenses/import/review-cards";
import { ReviewTable } from "@/components/expenses/import/review-table";
import { Amount } from "@/components/ui/amount";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Toolbar } from "@/components/ui/toolbar";
import { useApiForm } from "@/hooks/use-api-form";
import { useIsPhone } from "@/hooks/use-is-phone";
import { ApiError } from "@/lib/api/client";
import { afterImportChange } from "@/lib/api/invalidate";
import type { ImportConfirmResponse } from "@/lib/api/keys";
import { discardDescription } from "@/lib/imports/recent";
import { formatCurrency } from "@/lib/utils/currency";
import {
  addLabel,
  confirmRows,
  formatPeriod,
  initialReview,
  parserLabel,
  pluralize,
  rowErrorsFromFields,
  reviewReducer,
  rowProblems,
  summaryParts,
  tickedRows,
  tickedTotal,
  type ReviewAction,
} from "@/lib/imports/review";
import type { ImportDraft } from "@/lib/imports/types";

export const REOPENED_NOTE =
  "You already uploaded this statement, so this is the draft you started. Nothing is added twice.";

/** The explanation under the summary line: what starts unticked, and that nothing is saved yet. */
export const REVIEW_NOTE =
  "Nothing is saved until you press Add. Possible duplicates and rows in another currency start unticked.";

/**
 * The review screen: the summary, the rows with their ticks and edits, and a sticky footer with the
 * count, the total, Add and Discard. Ticks, descriptions and categories stay in this component until
 * Confirm; a reload brings the draft back as it was uploaded.
 */
export function ReviewStep({
  draft,
  accountCurrency,
  reopened = false,
  warnings = [],
  onConfirmed,
  onDiscarded,
  onStartOver,
}: {
  draft: ImportDraft;
  accountCurrency: string;
  /** The upload matched a draft that already existed. */
  reopened?: boolean;
  warnings?: readonly string[];
  onConfirmed: (result: ImportConfirmResponse) => void;
  onDiscarded: () => void;
  /** Back to the upload step, for a draft that is gone or was confirmed elsewhere. */
  onStartOver: () => void;
}) {
  const api = useImportApi();
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  // Below 768 px each row is a card; the table only scrolled sideways there.
  const phone = useIsPhone();
  const { batch, rows } = draft;
  const [items, dispatchReview] = useReducer(reviewReducer, rows, initialReview);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  /** The draft can't be confirmed any more (expired, or confirmed in another tab). */
  const [gone, setGone] = useState(false);

  const ticked = tickedRows(items);
  const total = tickedTotal(items);
  const problems = rowProblems(items);
  const blocked = ticked.length === 0 || Object.keys(problems).length > 0;
  const period = formatPeriod(batch.periodStart, batch.periodEnd);
  const duplicates = rows.filter((row) => row.duplicateOf).length;

  function edit(action: ReviewAction) {
    if ("id" in action) {
      // A server message about a row goes away as soon as the row is changed.
      setRowErrors((current) => action.id in current
        ? Object.fromEntries(Object.entries(current).filter(([id]) => id !== action.id))
        : current);
    }
    dispatchReview(action);
  }

  function confirm() {
    const sent = confirmRows(items);
    void form.submit(async () => {
      try {
        const result = await api.confirm(batch.id, sent);
        afterImportChange(mutate);
        onConfirmed(result);
      } catch (caught) {
        setConfirming(false);
        if (caught instanceof ApiError) {
          setRowErrors(rowErrorsFromFields(caught.fieldErrors, sent).byRow);
          setGone(caught.status === 404 || caught.status === 409);
        }
        throw caught;
      }
    }, { fallback: "The expenses could not be saved.", action: "confirm" });
  }

  function discard() {
    void form.submit(async () => {
      try {
        await api.discard(batch.id);
      } catch (caught) {
        // A draft that is already gone is as discarded as it can be.
        if (!(caught instanceof ApiError && caught.status === 404)) throw caught;
      }
      onDiscarded();
    }, { fallback: "The import could not be discarded.", action: "discard" });
  }

  const dialogOpen = confirming || discarding;

  return (
    <Stack gap="4">
      {reopened ? <InlineAlert status="info">{REOPENED_NOTE}</InlineAlert> : null}

      <Stack gap="3">
        <Stack gap="1">
          <Text textStyle="sectionTitle">
            {parserLabel(batch.parserId)}{period ? ` · ${period}` : ""}
          </Text>
          <Text textStyle="bodySm">{summaryParts(batch, rows).join(", ")}</Text>
          <Text textStyle="caption">{REVIEW_NOTE}</Text>
        </Stack>
        {/* What the reading found wrong (totals that differ, lines left unread), above the rows it concerns. */}
        {warnings.length > 0 ? (
          <Stack gap="2" role="group" aria-label="Warnings about this statement">
            {warnings.map((warning) => <InlineAlert key={warning} status="warning">{warning}</InlineAlert>)}
          </Stack>
        ) : null}
      </Stack>

      <Toolbar aria-label="Choose rows">
        <Button size="sm" variant="outline" onClick={() => edit({ type: "selectAll" })}>Select all</Button>
        <Button size="sm" variant="outline" onClick={() => edit({ type: "selectNone" })}>Select none</Button>
        {duplicates > 0 ? (
          <Button size="sm" variant="outline" onClick={() => edit({ type: "selectExceptDuplicates" })}>
            All except duplicates
          </Button>
        ) : null}
      </Toolbar>

      {phone ? (
        <ReviewCards items={items} accountCurrency={accountCurrency} rowErrors={rowErrors} dispatch={edit} />
      ) : (
        <ReviewTable items={items} accountCurrency={accountCurrency} rowErrors={rowErrors} dispatch={edit} />
      )}

      <Stack
        gap="3"
        position="sticky"
        bottom={{ base: "calc(3.5rem + env(safe-area-inset-bottom))", md: "0" }}
        zIndex="docked"
        bg="bg.surface"
        borderWidth="1px"
        borderColor="border"
        borderRadius="card"
        shadow="xs"
        px="4"
        py="3"
      >
        {form.error && !dialogOpen ? (
          <InlineAlert
            status="error"
            action={gone ? <Button size="xs" variant="outline" onClick={onStartOver}>Start over</Button> : undefined}
          >
            {form.error}
          </InlineAlert>
        ) : null}
        <Flex align="center" justify="space-between" gap="3" wrap="wrap">
          <Box aria-live="polite">
            <Text textStyle="bodySm" fontWeight="medium">
              {ticked.length} of {pluralize(rows.length, "row")} selected
            </Text>
            {Object.keys(problems).length > 0 ? (
              <Text textStyle="caption" color="fg.error">Fix the highlighted descriptions to continue.</Text>
            ) : (
              <Flex align="baseline" gap="1.5">
                <Text textStyle="caption">Total</Text>
                <Amount value={total} currency={accountCurrency} size="sm" />
              </Flex>
            )}
          </Box>
          <Flex gap="2" ms="auto">
            <Button
              variant="ghost"
              size={{ base: "md", sm: "sm" }}
              disabled={form.pending}
              onClick={() => {
                form.reset();
                setDiscarding(true);
              }}
            >
              Discard
            </Button>
            <Button
              variant="solid"
              colorPalette="brand"
              size={{ base: "md", sm: "sm" }}
              disabled={blocked || gone}
              onClick={() => {
                form.reset();
                setConfirming(true);
              }}
            >
              {addLabel(ticked.length)}
            </Button>
          </Flex>
        </Flex>
      </Stack>

      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!form.pending) setConfirming(next);
        }}
        title={`${addLabel(ticked.length)}?`}
        description={`${pluralize(ticked.length, "expense")}, ${formatCurrency(total, accountCurrency)} in total, will be added to your expenses. You can undo the import afterwards.`}
        confirmLabel={addLabel(ticked.length)}
        tone="brand"
        onConfirm={confirm}
        pending={form.pendingAction === "confirm"}
      />
      <ConfirmDialog
        open={discarding}
        onOpenChange={(next) => {
          if (!form.pending) setDiscarding(next);
        }}
        title="Discard this import?"
        description={discardDescription(rows.length)}
        confirmLabel="Discard"
        onConfirm={discard}
        pending={form.pendingAction === "discard"}
        error={form.error}
      />
    </Stack>
  );
}
