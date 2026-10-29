"use client";

import { Box, Button, Flex, Stack, Text } from "@chakra-ui/react";
import { RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { useImportApi } from "@/components/expenses/import/import-api";
import { UndoImportDialog } from "@/components/expenses/import/undo-dialog";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataLoading } from "@/components/ui/data-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { useApiForm } from "@/hooks/use-api-form";
import { ApiError } from "@/lib/api/client";
import { afterImportChange, afterImportDraftChange } from "@/lib/api/invalidate";
import { IMPORTS_API_KEY, type ImportsResponse } from "@/lib/api/keys";
import {
  discardDescription,
  formatInstantDay,
  importMeta,
  importTitle,
  undoneMessage,
  visibleImports,
} from "@/lib/imports/recent";
import type { RecentImport } from "@/lib/imports/repository";
import type { ImportStatus } from "@/lib/imports/types";

export const RECENT_IMPORTS_TITLE = "Recent imports";
export const RECENT_IMPORTS_NOTE = "Your last 20. A draft is kept for 24 hours.";
export const RECENT_IMPORTS_ERROR = "Your recent imports could not be loaded.";
export const DISCARDED_MESSAGE = "Import discarded. Nothing was added.";

const STATUS_LABEL: Record<ImportStatus, string> = { draft: "Draft", confirmed: "Imported", undone: "Undone" };
const STATUS_TONE: Record<ImportStatus, StatusTone> = { draft: "info", confirmed: "positive", undone: "neutral" };

/** The current time, refreshed every minute so "expires in 19 h" stays true while the page is open. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function ImportRow({
  item,
  now,
  disabled,
  onResume,
  onDiscard,
  onUndo,
}: {
  item: RecentImport;
  now: Date;
  disabled: boolean;
  onResume: (item: RecentImport) => void;
  onDiscard: (item: RecentImport) => void;
  onUndo: (item: RecentImport) => void;
}) {
  const { batch } = item;
  const title = importTitle(batch, now);
  // The buttons share the row on a phone and sit at its end from `sm`.
  const grow = { flex: { base: "1", sm: "initial" }, size: { base: "md", sm: "sm" } } as const;
  return (
    <Flex
      as="li"
      direction={{ base: "column", sm: "row" }}
      align={{ base: "stretch", sm: "center" }}
      gap="2.5"
      py="3"
      borderBottomWidth="1px"
      borderColor="border"
      _last={{ borderBottomWidth: "0" }}
      listStyleType="none"
    >
      <Stack flex="1" minW="0" gap="0.5">
        <Flex align="center" gap="2" wrap="wrap">
          <Text textStyle="bodySm" fontWeight="medium">{title}</Text>
          <StatusBadge tone={STATUS_TONE[batch.status]}>{STATUS_LABEL[batch.status]}</StatusBadge>
        </Flex>
        <Text textStyle="caption">{importMeta(item, now).join(" · ")}</Text>
      </Stack>
      {batch.status === "draft" ? (
        <Flex gap="2" flexShrink="0">
          <Button
            variant="solid"
            colorPalette="brand"
            aria-label={`Resume ${title}`}
            disabled={disabled}
            onClick={() => onResume(item)}
            {...grow}
          >
            <RotateCcw size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Resume
          </Button>
          <Button variant="ghost" aria-label={`Discard ${title}`} disabled={disabled} onClick={() => onDiscard(item)} {...grow}>
            Discard
          </Button>
        </Flex>
      ) : null}
      {batch.status === "confirmed" ? (
        <Flex gap="2" flexShrink="0">
          <Button variant="outline" aria-label={`Undo ${title}`} disabled={disabled} onClick={() => onUndo(item)} {...grow}>
            <Undo2 size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Undo
          </Button>
        </Flex>
      ) : null}
    </Flex>
  );
}

/** The rows of the list, without any request: drafts get Resume and Discard, confirmed imports Undo. */
export function RecentImportsList({
  imports,
  now,
  disabled = false,
  onResume,
  onDiscard,
  onUndo,
}: {
  imports: readonly RecentImport[];
  now: Date;
  disabled?: boolean;
  onResume: (item: RecentImport) => void;
  onDiscard: (item: RecentImport) => void;
  onUndo: (item: RecentImport) => void;
}) {
  return (
    <Box as="ul" m="0" p="0" aria-label={RECENT_IMPORTS_TITLE}>
      {imports.map((item) => (
        <ImportRow
          key={item.batch.id}
          item={item}
          now={now}
          disabled={disabled}
          onResume={onResume}
          onDiscard={onDiscard}
          onUndo={onUndo}
        />
      ))}
    </Box>
  );
}

/**
 * The caller's last 20 imports (`GET /api/imports`): drafts to resume or discard, confirmed imports
 * to undo, and undone ones for the record. Undo and Discard ask first; the undo dialog says how many
 * expenses go and how many were edited since. Nothing shows while the caller has no imports.
 */
export function RecentImports({ onResume }: { onResume: (id: string) => void }) {
  const api = useImportApi();
  const { mutate } = useSWRConfig();
  const { data, error, isLoading, mutate: reload } = useSWR<ImportsResponse>(IMPORTS_API_KEY);
  const form = useApiForm();
  const now = useNow();
  const [undoTarget, setUndoTarget] = useState<RecentImport | null>(null);
  const [discardTarget, setDiscardTarget] = useState<RecentImport | null>(null);
  const [message, setMessage] = useState("");

  const imports = data ? visibleImports(data.imports, now) : [];

  function undo() {
    const target = undoTarget;
    if (!target) return;
    void form.submit(async () => {
      try {
        const { removed } = await api.undo(target.batch.id);
        setMessage(undoneMessage(removed));
        setUndoTarget(null);
      } finally {
        // Success or not, the list may have moved on (undone in another tab, or too old to undo).
        afterImportChange(mutate);
      }
    }, { fallback: "The import could not be undone.", action: "undo" });
  }

  function discard() {
    const target = discardTarget;
    if (!target) return;
    void form.submit(async () => {
      try {
        await api.discard(target.batch.id);
      } catch (caught) {
        afterImportDraftChange(mutate);
        // A draft that is already gone is as discarded as it can be.
        if (!(caught instanceof ApiError && caught.status === 404)) throw caught;
      }
      afterImportDraftChange(mutate);
      setMessage(DISCARDED_MESSAGE);
      setDiscardTarget(null);
    }, { fallback: "The import could not be discarded.", action: "discard" });
  }

  if (error && !data) {
    return (
      <InlineAlert
        status="error"
        action={<Button size="xs" variant="outline" onClick={() => void reload()}>Retry</Button>}
      >
        {RECENT_IMPORTS_ERROR}
      </InlineAlert>
    );
  }
  if (isLoading && !data) return <DataLoading label="Loading your recent imports…" layout="section" />;
  if (imports.length === 0 && !message) return null;

  return (
    <Stack as="section" gap="3" aria-label={RECENT_IMPORTS_TITLE}>
      <SectionHeader title={RECENT_IMPORTS_TITLE} meta={RECENT_IMPORTS_NOTE} />
      {message ? <InlineAlert status="success">{message}</InlineAlert> : null}
      {imports.length > 0 ? (
        <Card>
          <Card.Body py="1">
            <RecentImportsList
              imports={imports}
              now={now}
              disabled={form.pending}
              onResume={(item) => {
                setMessage("");
                onResume(item.batch.id);
              }}
              onDiscard={(item) => {
                form.reset();
                setMessage("");
                setDiscardTarget(item);
              }}
              onUndo={(item) => {
                form.reset();
                setMessage("");
                setUndoTarget(item);
              }}
            />
          </Card.Body>
        </Card>
      ) : null}

      {undoTarget ? (
        <UndoImportDialog
          open
          onOpenChange={(next) => {
            if (!next && !form.pending) setUndoTarget(null);
          }}
          counts={undoTarget}
          importedOn={formatInstantDay(undoTarget.batch.confirmedAt ?? undoTarget.batch.createdAt, { now, long: true })}
          pending={form.pendingAction === "undo"}
          error={form.error}
          onConfirm={undo}
        />
      ) : null}
      {discardTarget ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next && !form.pending) setDiscardTarget(null);
          }}
          title="Discard this import?"
          description={discardDescription(discardTarget.batch.rowCount)}
          confirmLabel="Discard"
          onConfirm={discard}
          pending={form.pendingAction === "discard"}
          error={form.error}
        />
      ) : null}
    </Stack>
  );
}
