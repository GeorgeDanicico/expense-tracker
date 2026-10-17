"use client";

import { Stack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { InlineAlert } from "@/components/ui/inline-alert";

/** Confirmation for destructive or irreversible actions. */
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  pending = false,
  error,
  open,
  onOpenChange,
  trigger,
  tone = "danger",
  cancelTone,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  error?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ReactNode;
  tone?: "danger" | "brand";
  cancelTone?: "orange";
  children?: ReactNode;
}) {
  return (
    <AppDialog
      title={title}
      description={description}
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      placement="center"
      role="alertdialog"
      footer={
        <FormActions
          submitLabel={confirmLabel}
          cancelLabel={cancelLabel}
          closesDialog
          pending={pending}
          tone={tone}
          cancelTone={cancelTone}
          onSubmit={onConfirm}
        />
      }
    >
      {children || error ? (
        <Stack gap="3">
          {children}
          {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
        </Stack>
      ) : null}
    </AppDialog>
  );
}
