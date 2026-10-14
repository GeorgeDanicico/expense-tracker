"use client";

import { useCallback, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";

type FieldErrors = Record<string, string[]>;

export type ApiFormState = {
  /** The `action` of the submit in flight, or `null` when idle. */
  pendingAction: string | null;
  error: string;
  fieldErrors?: FieldErrors;
};

export type SubmitOptions = {
  /** Shown when the thrown value is not an `Error`. */
  fallback: string;
  /** Names the submit so a form with several actions can tell which one is pending. */
  action?: string;
};

export const IDLE_API_FORM_STATE: ApiFormState = { pendingAction: null, error: "" };

/** Maps a caught value to the message and field errors a form shows. */
export function apiFormError(caught: unknown, fallback: string): Pick<ApiFormState, "error" | "fieldErrors"> {
  return {
    error: caught instanceof Error ? caught.message : fallback,
    fieldErrors: caught instanceof ApiError ? caught.fieldErrors : undefined,
  };
}

/**
 * Runs one submission: ignores it while another is in flight, clears the
 * previous error, and records the new one if `fn` throws. Kept outside React
 * so it can be tested directly.
 */
export async function runApiSubmit(
  inFlight: { current: boolean },
  setState: (update: (state: ApiFormState) => ApiFormState) => void,
  fn: () => Promise<void>,
  { fallback, action = "submit" }: SubmitOptions,
) {
  if (inFlight.current) return;
  inFlight.current = true;
  setState(() => ({ pendingAction: action, error: "", fieldErrors: undefined }));
  try {
    await fn();
  } catch (caught) {
    const failure = apiFormError(caught, fallback);
    setState((state) => ({ ...state, ...failure }));
  } finally {
    inFlight.current = false;
    setState((state) => ({ ...state, pendingAction: null }));
  }
}

/**
 * Pending, error and field-error state for a form or button that calls the API.
 * Put the request and everything that should happen on success inside `fn`.
 */
export function useApiForm() {
  const [state, setState] = useState<ApiFormState>(IDLE_API_FORM_STATE);
  const inFlight = useRef(false);

  const submit = useCallback(
    (fn: () => Promise<void>, options: SubmitOptions) => runApiSubmit(inFlight, setState, fn, options),
    [],
  );
  /** Clears the error and field errors; a submit in flight keeps running. */
  const reset = useCallback(() => setState((state) => ({ ...state, error: "", fieldErrors: undefined })), []);

  return {
    pending: state.pendingAction !== null,
    pendingAction: state.pendingAction,
    error: state.error,
    fieldErrors: state.fieldErrors,
    fieldError: (name: string) => state.fieldErrors?.[name]?.[0],
    submit,
    reset,
  };
}

export type ApiForm = ReturnType<typeof useApiForm>;
