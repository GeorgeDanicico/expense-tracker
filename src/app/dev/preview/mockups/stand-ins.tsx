"use client";

/**
 * Pieces only the mockups need, on the real theme. The primitives U4 built (AppDialog as a sheet,
 * ActionBar, UndoToast, AmountInput, ToggleChip, Disclosure, Collapse, IconTile, RowActions) are
 * imported from src/components/ui, and so are U6's ChipMenu, ChipRow and SaveButton; what's left here
 * is for later tasks (swipes for U12) or for the mockups' fixtures.
 */

import { Box, chakra, Flex, Text } from "@chakra-ui/react";
import { useRef, useState, type ReactNode } from "react";

import { transition } from "@/components/ui/theme/motion";
import { rowRecipe } from "@/components/ui/theme/recipes/misc";

import { useMotionDelay } from "./motion-scope";

const Row = chakra("div", rowRecipe);

/** A list row on the theme's row recipe: leading tile, title and meta, trailing amount or buttons. */
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
    <Row bg="bg.surface">
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
    </Row>
  );
}

type SwipeSide = { label: string; tone: "positive" | "negative" | "warning"; commit?: boolean };
const SWIPE_TONES = {
  positive: { bg: "bg.success", color: "fg.success" },
  negative: { bg: "bg.error", color: "fg.error" },
  warning: { bg: "bg.warning", color: "fg.warning" },
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
    <Box position="relative" overflow="hidden" borderRadius="control">
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
