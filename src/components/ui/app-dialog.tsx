"use client";

import { Box, Dialog, Portal } from "@chakra-ui/react";
import { X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from "react";

import { FormActions } from "@/components/ui/form-actions";
import { IconButton } from "@/components/ui/icon-button";
import { ICON } from "@/components/ui/icon";
import { SHEET_BOTTOM_PADDING } from "@/components/ui/theme/slot-recipes/feedback";
import { PHONE_QUERY } from "@/hooks/use-is-phone";

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
  /**
   * Kept for compatibility: every dialog is a bottom sheet below `md` and a centred dialog from
   * `md` up, whichever is passed.
   */
  placement?: "sheet" | "center";
  /** Below 768 px the sheet fills the screen's height, for long forms. */
  fullHeightOnPhone?: boolean;
  /** While true (a request in flight) the dialog doesn't close, whatever closes it. */
  pending?: boolean;
  /**
   * Whether closing by accident (tapping outside, swiping the sheet down, Escape) should ask
   * first. When it isn't given, the dialog counts as dirty once anything inside it has been typed
   * in or changed. Cancel and the close button always close.
   */
  dirty?: boolean;
  role?: "dialog" | "alertdialog";
  closeLabel?: string;
  initialFocusEl?: () => HTMLElement | null;
  finalFocusEl?: () => HTMLElement | null;
  contentRef?: RefObject<HTMLDivElement | null>;
};

export type CloseReason = "dismiss" | "button";

/**
 * What a request to close does. A dialog with a request in flight stays open. An accidental close
 * (`dismiss`: tap outside, swipe down, Escape) of a dirty form asks first; Cancel and the close
 * button (`button`) close.
 */
export function closeDecision({ reason, dirty, pending }: { reason: CloseReason; dirty: boolean; pending: boolean }) {
  if (pending) return "stay";
  return reason === "dismiss" && dirty ? "ask" : "close";
}

/** A swipe down dismisses the sheet past 96 px, or a quick flick (0.5 px/ms) past 16 px. */
export function shouldDismissSheet(distance: number, velocity: number) {
  return distance > 96 || (distance > 16 && velocity > 0.5);
}

/**
 * Dragging the sheet down by its handle or header, on a phone only. Moves the content with the
 * finger, then either dismisses (`onDismiss`, which may refuse) or springs back.
 */
function useSheetDrag(content: RefObject<HTMLDivElement | null>, onDismiss: () => void) {
  const drag = useRef<{ id: number; y: number; time: number; distance: number } | null>(null);
  const move = (distance: number, animate: boolean) => {
    const style = content.current?.style;
    // The tokens' variables, so the reduced-motion block in global-css.ts turns this off too.
    style?.setProperty("transition", animate ? "transform var(--chakra-durations-moderate) var(--chakra-easings-standard)" : "none");
    style?.setProperty("transform", distance ? `translateY(${distance}px)` : "");
  };
  const end = (event: PointerEvent<HTMLElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    drag.current = null;
    const velocity = current.distance / Math.max(1, event.timeStamp - current.time);
    if (shouldDismissSheet(current.distance, velocity)) onDismiss();
    // Springs back; when the sheet does close, its exit animation starts from where it is.
    move(0, true);
  };
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0 || !window.matchMedia(PHONE_QUERY).matches) return;
      if ((event.target as HTMLElement).closest("button, a, input, select, textarea")) return;
      drag.current = { id: event.pointerId, y: event.clientY, time: event.timeStamp, distance: 0 };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      current.distance = Math.max(0, event.clientY - current.y);
      move(current.distance, false);
    },
    onPointerUp: end,
    onPointerCancel: end,
  };
}

/**
 * Standard dialog: a bottom sheet on a phone (drag handle, swipe down or tap outside to close) and
 * a centred dialog from `md` up, both from the theme's dialog recipe. Backdrop, close button,
 * title/description header, scrolling body, and footer, which stays above the keyboard. Focus is
 * trapped inside and returns to where it was on close. Content mounts lazily and unmounts on close
 * so forms reset between openings. A dirty form asks before an accidental close; nothing closes
 * while `pending`.
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
  fullHeightOnPhone = false,
  pending = false,
  dirty,
  role = "dialog",
  closeLabel = "Close dialog",
  initialFocusEl,
  finalFocusEl,
  contentRef,
}: AppDialogProps) {
  const [openOnItsOwn, setOpenOnItsOwn] = useState(false);
  const isOpen = open ?? openOnItsOwn;
  const [asking, setAsking] = useState(false);
  const changed = useRef(false);
  const ownContent = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isOpen) changed.current = false;
  }, [isOpen]);

  const setOpen = (next: boolean) => {
    if (open === undefined) setOpenOnItsOwn(next);
    onOpenChange?.(next);
  };
  /** Returns whether the dialog closed (or was already asked to). */
  const requestClose = (reason: CloseReason) => {
    const decision = closeDecision({ reason, dirty: dirty ?? changed.current, pending });
    if (decision === "close") setOpen(false);
    if (decision === "ask") setAsking(true);
    return decision === "close";
  };
  /** Tap outside and Escape: Chakra closes unless the event is stopped. */
  const guardDismiss = (event: { preventDefault: () => void }) => {
    const decision = closeDecision({ reason: "dismiss", dirty: dirty ?? changed.current, pending });
    if (decision === "close") return;
    event.preventDefault();
    if (decision === "ask") setAsking(true);
  };
  const drag = useSheetDrag(ownContent, () => requestClose("dismiss"));
  const grab = { ...drag, touchAction: { base: "none", md: "auto" } } as const;

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(details) => (details.open ? setOpen(true) : requestClose("button"))}
      onEscapeKeyDown={guardDismiss}
      onInteractOutside={guardDismiss}
      size={size}
      role={role}
      lazyMount
      unmountOnExit
      trapFocus
      restoreFocus
      initialFocusEl={initialFocusEl}
      finalFocusEl={finalFocusEl}
    >
      {trigger ? <Dialog.Trigger asChild>{trigger}</Dialog.Trigger> : null}
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content
            ref={(element: HTMLDivElement | null) => {
              ownContent.current = element;
              if (contentRef) contentRef.current = element;
            }}
            data-full-height-on-phone={fullHeightOnPhone ? "" : undefined}
            h={fullHeightOnPhone ? { base: "full", md: "auto" } : undefined}
            onInput={() => (changed.current = true)}
            onChange={() => (changed.current = true)}
          >
            <Box
              data-part="drag-handle"
              aria-hidden="true"
              display={{ base: "block", md: "none" }}
              flexShrink="0"
              py="2"
              cursor="grab"
              {...grab}
            >
              <Box width="10" height="1" mx="auto" borderRadius="pill" bg="border.strong" />
            </Box>
            <Dialog.Header {...grab}>
              <Dialog.Title>{title}</Dialog.Title>
              {description ? <Dialog.Description>{description}</Dialog.Description> : null}
            </Dialog.Header>
            {children ? (
              <Dialog.Body pb={footer ? undefined : { base: SHEET_BOTTOM_PADDING, md: "5" }}>{children}</Dialog.Body>
            ) : null}
            {footer ? <Dialog.Footer>{footer}</Dialog.Footer> : null}
            <Dialog.CloseTrigger asChild>
              <IconButton aria-label={closeLabel} size="xs">
                <X size={ICON.sm} aria-hidden="true" />
              </IconButton>
            </Dialog.CloseTrigger>
            {asking ? (
              <AppDialog
                open
                onOpenChange={setAsking}
                role="alertdialog"
                size="sm"
                title="Discard your changes?"
                description="What you've entered here will be lost."
                footer={
                  <FormActions
                    submitLabel="Discard"
                    cancelLabel="Keep editing"
                    closesDialog
                    tone="danger"
                    onSubmit={() => {
                      setAsking(false);
                      setOpen(false);
                    }}
                  />
                }
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
