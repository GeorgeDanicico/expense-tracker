"use client";

import { Box, Button, Flex, Stack, type ButtonProps } from "@chakra-ui/react";
import { Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { ActionBar } from "@/components/ui/action-bar";
import { ICON } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm, type ApiForm } from "@/hooks/use-api-form";
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
 * A form in a sheet: its fields, the error when a save fails, and at the bottom, within thumb reach,
 * the big save button (a submit, so Enter saves too) and "Save and add another" (left out with
 * `another={false}`, for an edit). Pair it with `useSheetSave`: `onSave(another)` runs the save.
 */
export function SheetForm({
  label,
  form,
  saved,
  onSave,
  another = true,
  children,
}: {
  /** What the save button says: "Save expense". */
  label: ReactNode;
  form: Pick<ApiForm, "error" | "pendingAction">;
  saved: boolean;
  onSave: (another: boolean) => void;
  another?: boolean;
  children: ReactNode;
}) {
  const busy = form.pendingAction !== null;
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSave(false);
      }}
    >
      <Stack gap="3">
        {children}
        {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
        <ActionBar placement="sheet">
          <Flex gap="2">
            <SaveButton type="submit" saved={saved} loading={form.pendingAction === "save"} disabled={busy && !saved}>
              {label}
            </SaveButton>
            {another ? (
              <Button type="button" variant="outline" size="md" loading={form.pendingAction === "another"} disabled={busy || saved} onClick={() => onSave(true)}>
                Save and add another
              </Button>
            ) : null}
          </Flex>
        </ActionBar>
      </Stack>
    </form>
  );
}
