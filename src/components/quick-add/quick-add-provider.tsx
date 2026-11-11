"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { useNavigation } from "@/components/layout/use-navigation";
import { lazySheet, useOpenedOnce } from "@/components/ui/lazy-sheet";
import { UndoToast, UNDO_MS } from "@/components/ui/undo-toast";
import { preloadWhenIdle } from "@/lib/client/preload";

import { initialKind, isQuickAddShortcut, quickAddKindsFor, readLastKind, rememberKind, type QuickAddKind } from "./kinds";
import type { QuickAddState, Saved } from "./quick-add-sheet";

export type QuickAddOptions = {
  /** The form to open on; the last one used on this device otherwise. */
  kind?: QuickAddKind;
};

/** The sheet: the four forms and what they pull in. Loaded ahead of the first tap, see `QuickAddProvider`. */
const quickAddSheet = lazySheet(() => import("./quick-add-sheet").then((module) => module.QuickAddSheet));
const QuickAddSheet = quickAddSheet.Sheet;
const loadSheet = quickAddSheet.preload;

/** Starts loading the sheet's script; the promise settles when it is in (tests wait on it). */
export const preloadQuickAddSheet = loadSheet;

const QuickAddContext = createContext<{
  open: (options?: QuickAddOptions) => void;
  /** Starts loading the sheet's script; the + and Add call it on hover, focus and touch. */
  preload: () => void;
}>({ open: () => undefined, preload: () => undefined });

/** Opens the quick-add sheet: the + in the bottom bar, Add at the top of the sidebar, N on desktop. */
export function useQuickAdd() {
  return useContext(QuickAddContext);
}

/** The sheet, its toast and the N shortcut, for everything inside the app shell. */
export function QuickAddProvider({ initial = null, children }: { initial?: QuickAddOptions | null; children: ReactNode }) {
  const router = useRouter();
  const { sections } = useNavigation();
  const kinds = useMemo(() => quickAddKindsFor(sections), [sections]);
  const offered = useMemo(() => kinds.map((entry) => entry.kind), [kinds]);
  const [isOpen, setOpen] = useState(initial !== null);
  // Kept while the sheet slides away, so its form doesn't change under it.
  const [asked, setAsked] = useState<QuickAddOptions>(initial ?? {});
  const [toast, setToast] = useState<Saved | null>(null);
  // Mounted from its first opening on, so its script is not asked for before that (or the idle preload).
  const wasOpened = useOpenedOnce(isOpen);
  const state: QuickAddState = { kind: initialKind(offered, asked.kind) };

  const open = useCallback((options: QuickAddOptions = {}) => {
    setAsked({ ...options, kind: initialKind(offered, options.kind, readLastKind()) });
    setOpen(true);
  }, [offered]);

  useEffect(() => preloadWhenIdle(loadSheet), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isQuickAddShortcut(event, Boolean(document.querySelector("[role=dialog], [role=alertdialog]")))) return;
      event.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), UNDO_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const value = useMemo(() => ({ open, preload: loadSheet }), [open]);
  return (
    <QuickAddContext.Provider value={value}>
      {children}
      {wasOpened ? <QuickAddSheet
        open={isOpen}
        state={state}
        kinds={kinds}
        onKindChange={(kind) => {
          rememberKind(kind);
          setAsked({ kind });
        }}
        onClose={() => setOpen(false)}
        onSaved={(saved, another) => {
          rememberKind(state.kind);
          setToast(saved);
          if (!another) setOpen(false);
        }}
      /> : null}
      <UndoToast
        message={toast?.message ?? null}
        actionLabel="View"
        onUndo={toast ? () => {
          setToast(null);
          router.push(toast.href);
        } : undefined}
      />
    </QuickAddContext.Provider>
  );
}
