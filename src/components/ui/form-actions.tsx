"use client";

import { Button, Dialog, Flex } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * Cancel + submit pair. Right-aligned on desktop, equal-width on mobile.
 * `closesDialog` turns Cancel into the surrounding dialog's close action.
 * `cancelTone` makes Cancel a solid button too, for when staying put is the answer to encourage.
 */
export function FormActions({
  submitLabel,
  cancelLabel = "Cancel",
  onCancel,
  closesDialog = false,
  pending = false,
  disabled = false,
  tone = "brand",
  cancelTone,
  form,
  onSubmit,
  leading,
}: {
  submitLabel: ReactNode;
  cancelLabel?: string;
  onCancel?: () => void;
  closesDialog?: boolean;
  pending?: boolean;
  disabled?: boolean;
  tone?: "brand" | "danger";
  cancelTone?: "orange";
  /** `id` of the form to submit, when the actions sit outside it. */
  form?: string;
  /** Click handler instead of a form submission. */
  onSubmit?: () => void;
  /** Extra content on the start side (e.g. a secondary action). */
  leading?: ReactNode;
}) {
  const responsive = { flex: { base: "1", sm: "initial" }, size: { base: "md", sm: "sm" } } as const;
  const cancel = onCancel || closesDialog ? (
    <Button
      variant={cancelTone ? "solid" : "ghost"}
      colorPalette={cancelTone}
      disabled={pending}
      onClick={onCancel}
      {...responsive}
    >
      {cancelLabel}
    </Button>
  ) : null;
  return (
    <Flex gap="2" justify="flex-end" align="center" width="full" wrap="wrap">
      {leading ? <Flex me="auto">{leading}</Flex> : null}
      {closesDialog && cancel ? (
        <Dialog.ActionTrigger asChild>{cancel}</Dialog.ActionTrigger>
      ) : (
        cancel
      )}
      <Button
        type={onSubmit ? "button" : "submit"}
        form={form}
        onClick={onSubmit}
        variant="solid"
        colorPalette={tone}
        loading={pending}
        disabled={disabled}
        {...responsive}
      >
        {submitLabel}
      </Button>
    </Flex>
  );
}
