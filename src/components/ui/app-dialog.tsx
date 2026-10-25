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
  /**
   * Below 768 px the sheet fills the screen's height: the header stays at the top, the body
   * scrolls and the footer stays on screen above the home indicator. For long forms.
   */
  fullHeightOnPhone?: boolean;
  role?: "dialog" | "alertdialog";
  closeLabel?: string;
  initialFocusEl?: () => HTMLElement | null;
  finalFocusEl?: () => HTMLElement | null;
  contentRef?: RefObject<HTMLDivElement | null>;
};

const DEFAULT_MAX_H = "calc(var(--available-height, 100dvh) - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 2rem)";

/** Chakra's dialog widths per size, restated for the full-height sheet's `md` breakpoint. */
const MAX_W = { sm: "md", md: "lg", lg: "2xl" } as const;

/** The full-height phone sheet's overrides; from `md` up the dialog is the usual centred one. */
const fullHeight = (size: keyof typeof MAX_W) => ({
  positioner: { p: { base: "0", md: "4" }, alignItems: { base: "stretch", md: "center" } },
  content: {
    my: { base: "0", md: "auto" },
    h: { base: "full", md: "auto" },
    maxH: { base: "full", md: DEFAULT_MAX_H },
    maxW: { base: "full", md: MAX_W[size] },
    borderRadius: { base: "0", md: "dialog" },
    overflowY: { base: "hidden", md: "auto" },
    pt: { base: "env(safe-area-inset-top)", md: "0" },
  },
  body: { flex: "1", minH: "0", overflowY: { base: "auto", md: "visible" } },
  footer: {
    pt: { base: "3", md: "0" },
    pb: { base: "calc(1rem + env(safe-area-inset-bottom))", md: "5" },
    borderTopWidth: { base: "1px", md: "0" },
    borderColor: "border",
  },
});

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
  fullHeightOnPhone = false,
  role = "dialog",
  closeLabel = "Close dialog",
  initialFocusEl,
  finalFocusEl,
  contentRef,
}: AppDialogProps) {
  const full = fullHeightOnPhone ? fullHeight(size) : null;
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
        <Dialog.Positioner {...full?.positioner}>
          <Dialog.Content
            ref={contentRef}
            data-full-height-on-phone={fullHeightOnPhone ? "" : undefined}
            {...full?.content}
          >
            <Dialog.Header>
              <Dialog.Title>{title}</Dialog.Title>
              {description ? (
                <Dialog.Description>{description}</Dialog.Description>
              ) : null}
            </Dialog.Header>
            {children ? <Dialog.Body {...full?.body}>{children}</Dialog.Body> : null}
            {footer ? <Dialog.Footer {...full?.footer}>{footer}</Dialog.Footer> : null}
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
