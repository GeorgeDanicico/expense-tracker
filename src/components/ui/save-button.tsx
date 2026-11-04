"use client";

import { Box, Button, Flex, type ButtonProps } from "@chakra-ui/react";
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ActionBar } from "@/components/ui/action-bar";
import { ICON } from "@/components/ui/icon";
import { useApiForm } from "@/hooks/use-api-form";
import { DURATION_MS } from "@/components/ui/theme/motion";
import { useReducedMotion } from "@/hooks/use-reduced-motion";

/**
 * A sheet's main button, which turns green with a check for a moment once saved ("Save check" in
 * docs/ui-direction.md). Pair it with `useSaveCheck`.
 */
export function SaveButton({ saved, children, ...props }: { saved: boolean } & Omit<ButtonProps, "variant" | "colorPalette">) {
  return (
    <Button variant="solid" colorPalette={saved ? "success" : "brand"} size="md" flex="1" aria-live="polite" {...props}>
      {saved ? (
        <Box
          as="span"
          display="inline-flex"
          animationName="scale-in, fade-in"
          animationDuration="slow"
          animationTimingFunction="enter"
          animationFillMode="both"
        >
          <Check size={ICON.nav} aria-hidden="true" />
        </Box>
      ) : null}
      {saved ? "Saved" : children}
    </Button>
  );
}

/**
 * Shows the save check, then calls `done` once it has been seen (at once under reduced motion: the
 * action always happens). `saved` is for `SaveButton`.
 */
export function useSaveCheck() {
  const reduced = useReducedMotion();
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const showCheck = useCallback((done: () => void) => {
    if (reduced) return done();
    setSaved(true);
    timer.current = window.setTimeout(() => {
      setSaved(false);
      done();
    }, DURATION_MS.countUp);
  }, [reduced]);
  return { saved, showCheck };
}

/**
 * A sheet form's save: the request (`write`), then the save check and `done(result, false)`, or,
 * for "Save and add another", `done(result, true)` at once so the form can clear itself. `form`
 * holds the pending state and errors (`pendingAction` is "save" or "another").
 */
export function useSheetSave() {
  const form = useApiForm();
  const { saved, showCheck } = useSaveCheck();
  const save = <T,>(another: boolean, write: () => Promise<T>, done: (result: T, another: boolean) => void) => {
    if (saved) return;
    void form.submit(async () => {
      const result = await write();
      if (another) done(result, true);
      else showCheck(() => done(result, false));
    }, { fallback: "Couldn't save. Try again.", action: another ? "another" : "save" });
  };
  return { form, saved, save };
}

/**
 * The bottom of a sheet form, within thumb reach: the big save button (a submit, so Enter saves too)
 * and "Save and add another".
 */
export function SaveBar({
  children,
  saved,
  pendingAction,
  onAnother,
}: {
  /** What the save button says: "Save expense". */
  children: ReactNode;
  saved: boolean;
  pendingAction: string | null;
  onAnother: () => void;
}) {
  const busy = pendingAction !== null;
  return (
    <ActionBar placement="sheet">
      <Flex gap="2">
        <SaveButton type="submit" saved={saved} loading={pendingAction === "save"} disabled={busy && !saved}>
          {children}
        </SaveButton>
        <Button type="button" variant="outline" size="md" loading={pendingAction === "another"} disabled={busy || saved} onClick={onAnother}>
          Save and add another
        </Button>
      </Flex>
    </ActionBar>
  );
}
