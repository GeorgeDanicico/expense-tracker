"use client";

import { Text } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useSWRConfig } from "swr";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { apiRequest } from "@/lib/api/client";
import { afterExpenseDeleted } from "@/lib/api/invalidate";

export function DeleteExpenseButton({ id, description }: { id: string; description: string }) {
  const { mutate } = useSWRConfig();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setPending(true);
    setError("");

    try {
      await apiRequest<{ success: true }>(`/api/expenses/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await afterExpenseDeleted(mutate, id);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delete expense.");
    } finally {
      setPending(false);
    }
  }

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <IconButton aria-label={`Delete ${description}`} size="xs" tone="danger">
          <Trash2 size={ICON.xs} strokeWidth={ICON_STROKE} />
        </IconButton>
      }
      title="Delete this expense?"
      description={
        <>
          <Text as="span" fontWeight="semibold" color="fg">{description}</Text> will be permanently removed from your ledger.
        </>
      }
      cancelLabel="Keep it"
      confirmLabel="Delete expense"
      pending={pending}
      error={error}
      onConfirm={() => void remove()}
    />
  );
}
