"use client";

import { Box, Flex, Portal, Text, type BoxProps } from "@chakra-ui/react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";

import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { useLazyMenu } from "@/components/ui/lazy-menu";
import { transition } from "@/components/ui/theme/motion";
import { SWIPE, useSwipe, type SwipeSide } from "@/components/ui/use-swipe";

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
  const { parts, placeholder, holdPlain, takeFocus, asked } = useLazyMenu({ open });
  const Menu = parts?.Menu;
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
        {Menu ? <Menu.Root
          lazyMount
          unmountOnExit
          defaultOpen={asked}
          open={open}
          onOpenChange={onOpenChange ? (details) => onOpenChange(details.open) : undefined}
          positioning={{
            placement: "bottom-end",
            getAnchorRect: anchor ? () => ({ x: anchor.x, y: anchor.y, width: 0, height: 0 }) : undefined,
          }}
          onSelect={({ value }) => actions.find((action) => action.label === value)?.onSelect()}
        >
          <Menu.Trigger asChild>
            <IconButton ref={takeFocus} aria-label={`More actions: ${label}`} size="sm">
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
        </Menu.Root> : (
          <IconButton ref={holdPlain} {...placeholder} aria-label={`More actions: ${label}`} size="sm">
            <MoreHorizontal size={ICON.sm} />
          </IconButton>
        )}
      </Box>
    </>
  );
}

/** Whether `target` takes typing, so a shortcut key belongs to it. */
export function isTypingTarget(target: EventTarget | null) {
  if (!target || typeof (target as Element).closest !== "function") return false;
  return Boolean((target as Element).closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']"));
}

/**
 * The desktop delete: a plain `Delete` (`Backspace` on Mac keyboards, which have no Delete key) on
 * a focused row or card (or a button in it), never while typing in a field. Deletes from it are
 * undone from the toast, like the swipe.
 */
export const DELETE_KEYS = "Delete Backspace";

export function isDeleteKey(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "repeat" | "defaultPrevented" | "target">) {
  if ((event.key !== "Delete" && event.key !== "Backspace") || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || event.defaultPrevented) return false;
  return !isTypingTarget(event.target);
}

/**
 * Before a row leaves (a keyboard delete), focus the next row matching `selector` in `scope`, or the
 * one before it when it was last, so focus stays in the list instead of falling to the page.
 */
export function focusNeighbour(row: Element, selector: string, scope: ParentNode = row.ownerDocument) {
  const rows = [...scope.querySelectorAll<HTMLElement>(selector)];
  const index = rows.findIndex((candidate) => candidate === row || candidate.contains(row));
  (rows[index + 1] ?? rows[index - 1])?.focus();
}

/** One side of a `SwipeRow`: what it shows behind the row, and what it does. */
export type SwipeAction = {
  label: string;
  icon: LucideIcon;
  tone: "danger" | "success" | "warning";
  onSwipe: () => void;
  /** Fly the row out before acting (a delete, Done); otherwise it snaps back (Snooze's choices). */
  commit?: boolean;
};

const SWIPE_TONES = {
  danger: { bg: "bg.error", color: "fg.error" },
  success: { bg: "bg.success", color: "fg.success" },
  warning: { bg: "bg.warning", color: "fg.warning" },
} as const;

/**
 * A row (or card) that swipes on a phone: left for `left`, right for `right` (`useSwipe`). The page
 * still scrolls up and down through it (`touch-action: pan-y`), a long press (the menu, the board's
 * drag, `holdMs`) still wins over a slow start, and a tap still opens the row. The swipe is never the
 * only way: the same actions stay in the row's `⋯`, its buttons, or the hover icons on desktop.
 * Reduced motion drops the slide and the fly-out, never the action. While it moves, the row takes
 * `bg` (the surface it sits on) so the action behind it doesn't show through.
 */
export function SwipeRow({
  left,
  right,
  holdMs = SWIPE.holdMs,
  as = "div",
  bg = "bg.surface",
  borderRadius = "control",
  children,
  ...rest
}: {
  left?: SwipeAction;
  right?: SwipeAction;
  holdMs?: number;
  as?: "div" | "li";
  bg?: string;
  borderRadius?: string;
  children: ReactNode;
} & Omit<BoxProps, "left" | "right" | "as" | "bg" | "borderRadius" | "children">) {
  const { state, handlers } = useSwipe({ left, right }, holdMs);
  const shown = state.side === "left" ? left : state.side === "right" ? right : undefined;
  const offset = state.out ? `${state.out === "left" ? "-" : ""}100%` : `${state.dx}px`;
  return (
    <Box as={as} position="relative" listStyleType="none" borderRadius={borderRadius} overflow={shown ? "hidden" : undefined} {...rest}>
      {shown ? <SwipeBackdrop action={shown} side={state.side as SwipeSide} /> : null}
      <Box
        position="relative"
        bg={shown ? bg : undefined}
        borderRadius={borderRadius}
        touchAction="pan-y"
        transition={state.dragging ? "none" : transition("transform", "moderate")}
        style={{ transform: state.dx || state.out ? `translateX(${offset})` : undefined }}
        {...handlers}
      >
        {children}
      </Box>
    </Box>
  );
}

function SwipeBackdrop({ action, side }: { action: SwipeAction; side: SwipeSide }) {
  return (
    <Flex
      position="absolute"
      inset="0"
      align="center"
      justify={side === "left" ? "flex-end" : "flex-start"}
      gap="2"
      px="5"
      borderRadius="inherit"
      {...SWIPE_TONES[action.tone]}
      aria-hidden="true"
    >
      <action.icon size={ICON.sm} strokeWidth={ICON_STROKE} />
      <Text as="span" textStyle="bodySm" fontWeight="semibold">{action.label}</Text>
    </Flex>
  );
}
