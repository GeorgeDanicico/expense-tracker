"use client";

/**
 * Plain stand-ins for the primitives U4 builds (bottom sheet, action bar, undo toast, amount input,
 * chips, row actions, swipe rows). They exist only so the mockups can show the behaviour; U4 writes
 * the real ones in src/components/ui with focus handling, tests and the theme's tokens.
 */

import { Box, Button, chakra, Flex, Menu, Portal, Stack, Text, type BoxProps, type HTMLChakraProps } from "@chakra-ui/react";
import { Check, ChevronDown, MoreHorizontal, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { ICON, IconButton } from "@/components/ui";

import { useMotionDelay } from "./motion-scope";
import { duration, easing, PROPOSED_SPACING, PROPOSED_TEXT, radius, transition } from "./proposed-theme";

/** A responsive value that stays on its phone form inside a contained demo (the /dev/ui Motion section). */
const responsive = <T,>(contained: boolean, base: T, md: T) => (contained ? base : { base, md });

/**
 * Bottom sheet on a phone, centred dialog from `md` up. Always mounted, so it slides both ways.
 * `contained` keeps it inside its positioned parent and always in its phone form.
 */
export function BottomSheet({
  open,
  onClose,
  label,
  children,
  footer,
  contained = false,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  footer?: ReactNode;
  contained?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const position = contained ? "absolute" : "fixed";
  const closedPhone = "translateY(105%)";
  return (
    <>
      <Box
        position={position}
        inset="0"
        zIndex="overlay"
        bg="backdrop"
        opacity={open ? 1 : 0}
        pointerEvents={open ? "auto" : "none"}
        transition={transition("opacity", "moderate")}
        onClick={onClose}
        aria-hidden="true"
      />
      <Box
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-hidden={!open}
        inert={!open}
        position={position}
        zIndex="modal"
        bg="bg.surface"
        boxShadow="overlay"
        insetX={responsive(contained, "0", "auto")}
        bottom={responsive(contained, "0", "auto")}
        top={responsive(contained, "auto", "50%")}
        left={responsive(contained, "0", "50%")}
        width={responsive(contained, "auto", "30rem")}
        maxH="calc(100dvh - 2rem)"
        overflowY="auto"
        borderTopRadius={responsive(contained, radius("sheet"), radius("card"))}
        borderBottomRadius={responsive(contained, "0", radius("card"))}
        px={responsive(contained, "4", "5")}
        pt={responsive(contained, "2.5", "5")}
        pb={responsive(contained, "calc(1rem + env(safe-area-inset-bottom))", "5")}
        opacity={responsive(contained, 1, open ? 1 : 0)}
        transform={responsive(
          contained,
          open ? "translateY(0)" : closedPhone,
          open ? "translate(-50%, -50%)" : "translate(-50%, -48%) scale(0.96)",
        )}
        transition={responsive(
          contained,
          transition("transform", "slow", open ? "enter" : "exit"),
          transition("transform, opacity", "moderate", open ? "enter" : "exit"),
        )}
      >
        <Box
          display={responsive(contained, "block", "none")}
          width="10"
          height="1"
          mx="auto"
          mb="3"
          borderRadius={radius("pill")}
          bg="border.strong"
          aria-hidden="true"
        />
        <Stack gap="4">
          {children}
          {footer}
        </Stack>
      </Box>
    </>
  );
}

/** The main button(s) of a sheet or page, at the bottom within thumb reach (U4's ActionBar). */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <Flex gap="2" pt="1" position="sticky" bottom="0" bg="bg.surface">
      {children}
    </Flex>
  );
}

/** A primary button that turns into a check for a moment once saved. */
export function SaveButton({ saved, onClick, children }: { saved: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="solid" colorPalette={saved ? "success" : "brand"} size="md" flex="1" onClick={onClick} aria-live="polite">
      {saved ? (
        <Box
          as="span"
          display="inline-flex"
          animationName="scale-in, fade-in"
          animationDuration={duration("slow")}
          animationTimingFunction={easing("enter")}
          animationFillMode="both"
        >
          <Check size={ICON.nav} aria-hidden="true" />
        </Box>
      ) : null}
      {saved ? "Saved" : children}
    </Button>
  );
}

/** Saves, shows the check for a moment, then calls `done`. */
export function useSaveCheck(done: () => void) {
  const [saved, setSaved] = useState(false);
  const later = useMotionDelay();
  const save = () => {
    if (saved) return;
    setSaved(true);
    later(450, () => {
      setSaved(false);
      done();
    });
  };
  return { saved, save };
}

/** "Deleted · Undo" above the bottom bar (U4's UndoToast). */
export function UndoToast({
  message,
  action,
  onAction,
  contained = false,
}: {
  message: string | null;
  action?: string;
  onAction?: () => void;
  contained?: boolean;
}) {
  // Keeps the last text while it slides out.
  const [last, setLast] = useState({ message, action });
  if (message && (message !== last.message || action !== last.action)) setLast({ message, action });
  const shown = Boolean(message);
  return (
    <Flex
      role="status"
      aria-hidden={!shown}
      inert={!shown}
      position={contained ? "absolute" : "fixed"}
      zIndex="toast"
      left={responsive(contained, "4", "auto")}
      right={responsive(contained, "4", "6")}
      bottom={contained ? "4" : { base: "calc(6rem + env(safe-area-inset-bottom))", md: "6" }}
      width={responsive(contained, "auto", "24rem")}
      align="center"
      justify="space-between"
      gap="3"
      px="4"
      py="2"
      minH="12"
      borderRadius={radius("card")}
      bg="fg"
      color="bg.surface"
      boxShadow="overlay"
      opacity={shown ? 1 : 0}
      transform={shown ? "none" : "translateY(1.25rem)"}
      transition={transition("transform, opacity", "moderate")}
      pointerEvents={shown ? "auto" : "none"}
    >
      <Text textStyle="body">{last.message}</Text>
      {last.action ? (
        <chakra.button type="button" data-pressable px="2" py="2" color="brand.muted" fontWeight="semibold" onClick={onAction}>
          {last.action}
        </chakra.button>
      ) : null}
    </Flex>
  );
}

/** Amount first: the decimal keypad, the currency shown, two decimals at most (U4's AmountInput). */
export function AmountInput({ value, onChange, symbol = "€" }: { value: string; onChange: (value: string) => void; symbol?: string }) {
  return (
    <Flex align="baseline" justify="center" gap="1.5" pt="1">
      <Text as="span" textStyle="amountLg" color="fg.subtle" aria-hidden="true">
        {symbol}
      </Text>
      <chakra.input
        data-autofocus
        inputMode="decimal"
        aria-label="Amount in euros"
        placeholder="0.00"
        value={value}
        onChange={(event) => {
          const next = event.target.value.replace(",", ".");
          if (/^\d{0,7}(\.\d{0,2})?$/.test(next)) onChange(next);
        }}
        width={`${Math.max(4, value.length) + 0.5}ch`}
        bg="transparent"
        borderWidth="0"
        outline="none"
        textAlign="center"
        fontVariantNumeric="tabular-nums"
        caretColor="fg.accent"
        {...PROPOSED_TEXT.amountInput}
      />
    </Flex>
  );
}

/**
 * A pill (U4: `ToggleChip`, from the layout report). `pressed` makes it a toggle; without it the chip
 * only looks `selected` (a menu trigger showing its current choice).
 */
export function Chip({
  selected,
  pressed,
  children,
  ...props
}: { selected?: boolean; pressed?: boolean; children: ReactNode } & Omit<HTMLChakraProps<"button">, "css">) {
  selected ??= pressed ?? false;
  return (
    <chakra.button
      type="button"
      data-pressable="chip"
      aria-pressed={pressed}
      position="relative"
      display="inline-flex"
      alignItems="center"
      gap="1.5"
      flexShrink="0"
      whiteSpace="nowrap"
      height={{ base: "9", md: "8" }}
      px="3"
      borderWidth="1px"
      borderRadius={radius("pill")}
      borderColor={selected ? "brand.border" : "border.strong"}
      bg={selected ? "bg.selected" : "bg.surface"}
      color={selected ? "fg.accent" : "fg"}
      textStyle="bodySm"
      fontWeight="medium"
      _hover={{ bg: selected ? "bg.selected" : "bg.subtle" }}
      // A 44 px hit area around a 36 px chip on touch screens.
      _before={{ content: '""', position: "absolute", insetX: "0", top: "50%", height: "2.75rem", transform: "translateY(-50%)" }}
      {...props}
    >
      {children}
    </chakra.button>
  );
}

/** A chip that opens a menu of choices: "Today ▾", "Me ▾". */
export function ChipMenu({
  label,
  items,
  onSelect,
  selected = true,
}: {
  label: ReactNode;
  items: { value: string; label: string }[];
  onSelect?: (value: string) => void;
  selected?: boolean;
}) {
  return (
    <Menu.Root positioning={{ placement: "bottom-start" }} onSelect={({ value }) => onSelect?.(value)}>
      <Menu.Trigger asChild>
        <Chip selected={selected}>
          {label}
          <Text as="span" aria-hidden="true" color="fg.subtle">
            ▾
          </Text>
        </Chip>
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="44">
            {items.map((item) => (
              <Menu.Item key={item.value} value={item.value}>
                {item.label}
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}

/** A sideways-scrolling row of chips that bleeds to the screen edge on phones. */
export function ChipRow({ children, label }: { children: ReactNode; label: string }) {
  return (
    <Flex
      role="group"
      aria-label={label}
      gap="2"
      overflowX="auto"
      mx={{ base: "-4", md: "0" }}
      px={{ base: "4", md: "0" }}
      py="1"
      css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
    >
      {children}
    </Flex>
  );
}

/** Folded-away content behind a quiet toggle: "More details", "Done · 3" (U4's Disclosure). */
export function Disclosure({ label, children }: { label: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Stack gap="0">
      <Button variant="ghost" size="sm" alignSelf="flex-start" color="fg.muted" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
        <Box as="span" display="inline-flex" transform={open ? "rotate(180deg)" : "none"} transition={transition("transform", "moderate")}>
          <ChevronDown size={ICON.sm} aria-hidden="true" />
        </Box>
      </Button>
      <CollapseRow gone={!open}>
        <Stack gap="3" pt="2">
          {children}
        </Stack>
      </CollapseRow>
    </Stack>
  );
}

/** The 40 px coloured square in front of a row, so a list can be scanned by shape. */
export function IconTile({ icon: Icon, bg, color }: { icon: LucideIcon; bg: string; color: BoxProps["color"] }) {
  return (
    <Flex boxSize={PROPOSED_SPACING.tile} flexShrink="0" align="center" justify="center" borderRadius={radius("control")} bg={bg} color={color}>
      <Icon size={ICON.nav} aria-hidden="true" />
    </Flex>
  );
}

export type RowAction = { label: string; icon: LucideIcon; onSelect: () => void; tone?: "danger" };

/**
 * A row's other actions (U4's RowActions): `⋯` on a phone (U4 adds long-press), icons on hover or
 * focus on desktop. `phoneMenu={false}` leaves a glanceable list (Home) without the `⋯`.
 */
export function RowActions({ label, actions, phoneMenu = true }: { label: string; actions: RowAction[]; phoneMenu?: boolean }) {
  return (
    <>
      <Flex data-hover-actions display={{ base: "none", md: "flex" }} gap="1">
        {actions.map((action) => (
          <IconButton key={action.label} aria-label={`${action.label}: ${label}`} tooltip size="sm" tone={action.tone} onClick={action.onSelect}>
            <action.icon size={ICON.sm} />
          </IconButton>
        ))}
      </Flex>
      <Box display={{ base: phoneMenu ? "block" : "none", md: "none" }}>
        <Menu.Root positioning={{ placement: "bottom-end" }} onSelect={({ value }) => actions.find((action) => action.label === value)?.onSelect()}>
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

const DESKTOP = "@media (min-width: 48rem)";

/** On desktop, `RowActions`' icons appear when their row or card is hovered or focused. */
export const REVEAL_HOVER_ACTIONS = {
  [DESKTOP]: {
    "& [data-hover-actions]": { opacity: 0, transition: transition("opacity", "fast") },
    "&:hover [data-hover-actions], &:focus-within [data-hover-actions]": { opacity: 1 },
  },
};

/** A row also tints on hover on desktop. */
const HOVER_ROW = { [DESKTOP]: { "&:hover": { bg: "bg.subtle" }, ...REVEAL_HOVER_ACTIONS[DESKTOP] } };

/** A list row: leading tile, title and meta, trailing amount or buttons. */
export function MockRow({
  leading,
  title,
  meta,
  trailing,
  metaTone,
}: {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  metaTone?: "error";
}) {
  return (
    <Flex
      align="center"
      gap="3"
      minH={PROPOSED_SPACING.rowMinH}
      py="2"
      px="2"
      borderRadius={radius("control")}
      bg="bg.surface"
      css={HOVER_ROW}
    >
      {leading}
      <Box flex="1" minW="0">
        <Text textStyle="body" fontWeight="medium" lineClamp={2}>
          {title}
        </Text>
        {meta ? (
          <Text textStyle="bodySm" color={metaTone === "error" ? "fg.error" : "fg.muted"} fontWeight={metaTone ? "medium" : undefined} truncate>
            {meta}
          </Text>
        ) : null}
      </Box>
      {trailing ? (
        <Flex align="center" gap="1.5" flexShrink="0">
          {trailing}
        </Flex>
      ) : null}
    </Flex>
  );
}

/**
 * A row that collapses out when `gone` (the grid-rows trick, no measuring) and slides in when
 * `entering`. Undo sets `gone` back and it opens again.
 */
export function CollapseRow({ gone = false, entering = false, children }: { gone?: boolean; entering?: boolean; children: ReactNode }) {
  return (
    <Box
      display="grid"
      gridTemplateRows={gone ? "0fr" : "1fr"}
      opacity={gone ? 0 : 1}
      transition={transition("grid-template-rows, opacity", "moderate")}
      animationName={entering ? "slide-from-top, fade-in" : undefined}
      animationDuration={duration("slow")}
      animationTimingFunction={easing("enter")}
      animationFillMode="both"
      aria-hidden={gone}
      inert={gone}
    >
      <Box overflow="hidden" minH="0">
        {children}
      </Box>
    </Box>
  );
}

/**
 * `bg.error`, `bg.success`, `bg.warning` and `bg.info` resolve to nothing today: the raw `status.*Bg`
 * tokens and the semantic `status.*.bg` ones share a CSS variable name, which then refers to itself
 * (see "Found on the way" in docs/ui-direction.md). Until that's fixed these category tokens, with the
 * same or nearly the same values, stand in.
 */
export const STATUS_SURFACE = {
  error: "category.health.bg",
  success: "category.groceries.bg",
  warning: "category.transport.bg",
  info: "category.housing.bg",
} as const;

type SwipeSide = { label: string; tone: "positive" | "negative" | "warning"; commit?: boolean };
const SWIPE_TONES = {
  positive: { bg: STATUS_SURFACE.success, color: "fg.success" },
  negative: { bg: STATUS_SURFACE.error, color: "fg.error" },
  warning: { bg: STATUS_SURFACE.warning, color: "fg.warning" },
};

/**
 * Swipe sideways to act (U12 builds the real one on U4's RowActions). Moving 10 px sideways before
 * moving vertically starts a swipe; past 80 px it acts. A `commit` side flies the row out first.
 */
export function SwipeRow({
  left,
  right,
  onSwipe,
  gone = false,
  children,
}: {
  left?: SwipeSide;
  right?: SwipeSide;
  onSwipe: (side: "left" | "right") => void;
  gone?: boolean;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [wasGone, setWasGone] = useState(gone);
  const gesture = useRef({ x: 0, y: 0, active: false, decided: false });
  const later = useMotionDelay();
  if (gone !== wasGone) {
    setWasGone(gone);
    if (!gone) setDx(0);
  }

  const end = () => {
    const { decided } = gesture.current;
    gesture.current.active = false;
    setDragging(false);
    if (!decided) return;
    const side = dx <= -80 && left ? "left" : dx >= 80 && right ? "right" : null;
    const config = side === "left" ? left : side === "right" ? right : null;
    if (!side || !config) return setDx(0);
    if (config.commit) {
      setDx(side === "left" ? -480 : 480);
      later(180, () => onSwipe(side));
    } else {
      setDx(0);
      onSwipe(side);
    }
  };

  const showing = dx < 0 ? left : dx > 0 ? right : undefined;
  return (
    <Box position="relative" overflow="hidden" borderRadius={radius("control")}>
      {showing ? (
        <Flex
          position="absolute"
          inset="0"
          align="center"
          justify={dx < 0 ? "flex-end" : "flex-start"}
          px="5"
          textStyle="bodySm"
          fontWeight="semibold"
          {...SWIPE_TONES[showing.tone]}
          aria-hidden="true"
        >
          {showing.label}
        </Flex>
      ) : null}
      <Box
        position="relative"
        touchAction="pan-y"
        userSelect="none"
        transform={`translateX(${dx}px)`}
        transition={dragging ? "none" : transition("transform", "moderate")}
        onPointerDown={(event) => {
          gesture.current = { x: event.clientX, y: event.clientY, active: true, decided: false };
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (!g.active) return;
          const mx = event.clientX - g.x;
          const my = event.clientY - g.y;
          if (!g.decided) {
            if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) {
              g.active = false;
              return;
            }
            if (Math.abs(mx) <= 10) return;
            g.decided = true;
            setDragging(true);
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          setDx((!left && mx < 0) || (!right && mx > 0) ? 0 : mx);
        }}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {children}
      </Box>
    </Box>
  );
}
