"use client";

import { chakra, Flex, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";

import { pressFeedback, transition } from "@/components/ui/theme/motion";
import { PAGE_SPACING } from "@/components/ui/theme/layout";

/** How long "Deleted · Undo" stays before the write is sent. */
export const UNDO_MS = 5000;

export type UndoEntry = {
  /** What happened, in a few words: "Expense deleted". */
  message: string;
  /** Sends the write. Called once, when the toast expires, the page is hidden or another entry replaces it. */
  commit: () => void | Promise<void>;
  /** Puts the row back. Called instead of `commit` when the user taps Undo. */
  restore?: () => void;
};

/**
 * The deferred write behind an undo toast, without React: one entry at a time. A new entry commits
 * the one before it at once, so nothing waits forever and nothing is lost.
 */
export function createUndoQueue({
  delay = UNDO_MS,
  onChange,
}: {
  delay?: number;
  /** The entry on show, or null when there is none. */
  onChange: (entry: UndoEntry | null) => void;
}) {
  let current: UndoEntry | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const take = () => {
    const entry = current;
    current = null;
    clearTimeout(timer);
    onChange(null);
    return entry;
  };

  return {
    /** Shows the toast for `entry` and sends its write when the time is up. */
    schedule(entry: UndoEntry) {
      void take()?.commit();
      current = entry;
      onChange(entry);
      timer = setTimeout(() => void take()?.commit(), delay);
    },
    /** Cancels the write and puts the row back. */
    undo() {
      take()?.restore?.();
    },
    /** Sends the waiting write now (the page is being hidden or left). */
    flush() {
      void take()?.commit();
    },
  };
}

/**
 * Deletes (or any write) with "Undo" instead of a confirmation: `schedule` hides the row at once
 * (the caller does that), shows the toast for 5 s and sends the write only when it expires, when
 * the page is hidden, or when this component unmounts. Spread `toast` on an `UndoToast`.
 * Where the API can only write at once, `commit` can be a no-op and `restore` the reversing write.
 */
export function useUndo(delay = UNDO_MS) {
  const [entry, setEntry] = useState<UndoEntry | null>(null);
  const [queue] = useState(() => createUndoQueue({ delay, onChange: setEntry }));

  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") queue.flush();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", queue.flush);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", queue.flush);
      queue.flush();
    };
  }, [queue]);

  return { schedule: queue.schedule, toast: { message: entry?.message ?? null, onUndo: queue.undo } };
}

/**
 * "Expense deleted · Undo" above the phone's bottom bar (bottom right on desktop). It slides in and
 * out with the motion tokens and keeps its text while it leaves. `contained` keeps it inside its
 * positioned parent (the gallery).
 */
export function UndoToast({
  message,
  onUndo,
  actionLabel = "Undo",
  contained = false,
}: {
  message: string | null;
  onUndo: () => void;
  actionLabel?: string;
  contained?: boolean;
}) {
  const [last, setLast] = useState(message);
  if (message && message !== last) setLast(message);
  const shown = Boolean(message);
  return (
    <Flex
      role="status"
      aria-live="polite"
      aria-hidden={!shown}
      inert={!shown}
      position={contained ? "absolute" : "fixed"}
      zIndex="toast"
      left={contained ? "4" : { base: "4", md: "auto" }}
      right={contained ? "4" : { base: "4", md: "6" }}
      bottom={contained ? "4" : { base: `calc(${PAGE_SPACING.bottomBar} + 0.75rem)`, md: "6" }}
      width={contained ? "auto" : { base: "auto", md: "24rem" }}
      align="center"
      justify="space-between"
      gap="3"
      ps="4"
      pe="2"
      minH="12"
      borderRadius="card"
      bg="fg"
      color="bg.surface"
      boxShadow="overlay"
      opacity={shown ? 1 : 0}
      transform={shown ? "none" : "translateY(1.25rem)"}
      transition={transition("transform, opacity", "moderate")}
      pointerEvents={shown ? "auto" : "none"}
    >
      <Text textStyle="body">{last}</Text>
      <chakra.button
        type="button"
        minH="11"
        px="3"
        borderRadius="control"
        color="brand.muted"
        fontWeight="semibold"
        onClick={onUndo}
        css={pressFeedback()}
      >
        {actionLabel}
      </chakra.button>
    </Flex>
  );
}
