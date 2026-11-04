"use client";

import { Box, Flex, Menu, Portal } from "@chakra-ui/react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useState, type MouseEvent, type PointerEvent } from "react";

import { ICON } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";

export type RowAction = { label: string; icon: LucideIcon; onSelect: () => void; tone?: "danger" };

type Point = { x: number; y: number };

/** How long a finger rests on a row before its menu opens, and how far it may drift meanwhile. */
export const LONG_PRESS = { delay: 500, tolerance: 10 } as const;

/**
 * Long-press handlers for a row, without React: a touch or pen held still for `delay` calls
 * `onLongPress` with where it was. Moving more than `tolerance` (a scroll, a swipe) or lifting
 * earlier cancels it; the click that follows a long press is swallowed, and so is the browser's
 * own long-press menu. A mouse uses the `⋯` button or the hover actions instead.
 */
export function createLongPress(onLongPress: (point: Point) => void, { delay, tolerance } = LONG_PRESS) {
  let start: Point | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fired = false;
  const cancel = () => {
    clearTimeout(timer);
    start = null;
  };
  return {
    onPointerDown(event: PointerEvent) {
      if (event.pointerType === "mouse" || event.button !== 0) return;
      fired = false;
      const point = { x: event.clientX, y: event.clientY };
      start = point;
      timer = setTimeout(() => {
        start = null;
        fired = true;
        onLongPress(point);
      }, delay);
    },
    onPointerMove(event: PointerEvent) {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > tolerance) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onContextMenu(event: MouseEvent) {
      if (start || fired) event.preventDefault();
    },
    onClickCapture(event: MouseEvent) {
      if (!fired) return;
      fired = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

/**
 * A row's long-press menu: spread `rowProps` on the row and `menu` on its `RowActions`, so holding
 * the row opens the same menu as its `⋯`, at the finger.
 */
export function useRowActions() {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Point | null>(null);
  // State setters never change, so the handlers can be made once.
  const [rowProps] = useState(() =>
    createLongPress((point) => {
      setAnchor(point);
      setOpen(true);
    }),
  );
  return {
    rowProps,
    menu: {
      open,
      anchor,
      onOpenChange: (next: boolean) => {
        setOpen(next);
        if (!next) setAnchor(null);
      },
    },
  };
}

/**
 * A row's other actions. On a phone, a `⋯` menu (and the long-press menu, with `useRowActions`);
 * on desktop, the actions as icon buttons that show when the row is hovered or focused (the row
 * recipe hides them otherwise). `phoneMenu={false}` leaves a glanceable list (Home) without `⋯`.
 */
export function RowActions({
  label,
  actions,
  phoneMenu = true,
  open,
  onOpenChange,
  anchor = null,
}: {
  /** The row's name, for the buttons' labels: "Delete: Weekly groceries". */
  label: string;
  actions: readonly RowAction[];
  phoneMenu?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Where a long press opened the menu; the menu opens under the `⋯` otherwise. */
  anchor?: Point | null;
}) {
  return (
    <>
      <Flex data-row-actions display={{ base: "none", md: "flex" }} gap="1">
        {actions.map((action) => (
          <IconButton key={action.label} aria-label={`${action.label}: ${label}`} tooltip size="sm" tone={action.tone} onClick={action.onSelect}>
            <action.icon size={ICON.sm} />
          </IconButton>
        ))}
      </Flex>
      <Box display={{ base: phoneMenu ? "block" : "none", md: "none" }}>
        <Menu.Root
          open={open}
          onOpenChange={onOpenChange ? (details) => onOpenChange(details.open) : undefined}
          positioning={{
            placement: "bottom-end",
            getAnchorRect: anchor ? () => ({ x: anchor.x, y: anchor.y, width: 0, height: 0 }) : undefined,
          }}
          onSelect={({ value }) => actions.find((action) => action.label === value)?.onSelect()}
        >
          <Menu.Trigger asChild>
            <IconButton aria-label={`More actions: ${label}`} size="sm">
              <MoreHorizontal size={ICON.sm} />
            </IconButton>
          </Menu.Trigger>
          <Portal>
            <Menu.Positioner>
              <Menu.Content minW="44">
                {actions.map((action) => (
                  <Menu.Item key={action.label} value={action.label} color={action.tone === "danger" ? "fg.error" : undefined}>
                    <action.icon size={ICON.sm} aria-hidden="true" />
                    {action.label}
                  </Menu.Item>
                ))}
              </Menu.Content>
            </Menu.Positioner>
          </Portal>
        </Menu.Root>
      </Box>
    </>
  );
}
