"use client";

import { Dialog, Portal } from "@chakra-ui/react";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { ICON } from "@/components/ui/icon";

export type AppDialogProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Element that opens the dialog (rendered with `asChild`). */
  trigger?: ReactNode;
  /** Actions row, usually `<FormActions>`. */
  footer?: ReactNode;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: "sm" | "md" | "lg";
  /** `sheet` docks to the bottom on mobile and centres on desktop. */
  placement?: "sheet" | "center";
  role?: "dialog" | "alertdialog";
  closeLabel?: string;
  initialFocusEl?: () => HTMLElement | null;
  finalFocusEl?: () => HTMLElement | null;
  contentRef?: RefObject<HTMLDivElement | null>;
};

/**
 * Standard dialog: backdrop, positioner, close button, title/description
 * header, scrolling body, and footer. Content mounts lazily and unmounts on
 * close so forms reset between openings.
 */
export function AppDialog({
  title,
  description,
  trigger,
  footer,
  children,
  open,
  onOpenChange,
  size = "md",
  placement = "sheet",
  role = "dialog",
  closeLabel = "Close dialog",
  initialFocusEl,
  finalFocusEl,
  contentRef,
}: AppDialogProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange ? (details) => onOpenChange(details.open) : undefined}
      size={size}
      placement={placement === "sheet" ? "bottom" : "center"}
      role={role}
      lazyMount
      unmountOnExit
      initialFocusEl={initialFocusEl}
      finalFocusEl={finalFocusEl}
    >
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content ref={contentRef}>
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
              {description ? (
                <Dialog.Description>{description}</Dialog.Description>
              ) : null}
            </Dialog.Header>
            {children ? <Dialog.Body>{children}</Dialog.Body> : null}
            {footer ? <Dialog.Footer>{footer}</Dialog.Footer> : null}
            <Dialog.CloseTrigger asChild>
              <IconButton aria-label={closeLabel} size="xs">
                <X size={ICON.sm} aria-hidden="true" />
              </IconButton>
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
