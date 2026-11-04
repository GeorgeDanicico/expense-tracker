import { ChakraProvider } from "@chakra-ui/react";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppDialog, closeDecision, shouldDismissSheet } from "@/components/ui/app-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ledgerSystem } from "@/components/ui/theme";

type RootProps = {
  open?: boolean;
  trapFocus?: boolean;
  restoreFocus?: boolean;
  initialFocusEl?: () => HTMLElement | null;
  finalFocusEl?: () => HTMLElement | null;
  role?: string;
  onOpenChange: (details: { open: boolean }) => void;
  onEscapeKeyDown: (event: { preventDefault: () => void }) => void;
  onInteractOutside: (event: { preventDefault: () => void }) => void;
};

/** The props AppDialog gives Chakra's (Zag's) dialog, which does the focus trap and restore. */
const roots = vi.hoisted(() => [] as RootProps[]);
vi.mock("@chakra-ui/react", async (importOriginal) => {
  const chakra = await importOriginal<typeof import("@chakra-ui/react")>();
  function Root(props: ComponentProps<typeof chakra.Dialog.Root>) {
    roots.push(props as unknown as RootProps);
    return <chakra.Dialog.Root {...props} />;
  }
  return { ...chakra, Dialog: { ...chakra.Dialog, Root } };
});

const render = (element: React.ReactElement) => renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{element}</ChakraProvider>);
const outermost = () => roots[0];
const dismissEvent = () => ({ preventDefault: vi.fn() });

beforeEach(() => {
  roots.length = 0;
});

describe("closeDecision", () => {
  it("closes a clean dialog however it is closed", () => {
    expect(closeDecision({ reason: "dismiss", dirty: false, pending: false })).toBe("close");
    expect(closeDecision({ reason: "button", dirty: false, pending: false })).toBe("close");
  });

  it("asks before an accidental close of a dirty form, but not before Cancel", () => {
    expect(closeDecision({ reason: "dismiss", dirty: true, pending: false })).toBe("ask");
    expect(closeDecision({ reason: "button", dirty: true, pending: false })).toBe("close");
  });

  it("stays open while a request is in flight", () => {
    expect(closeDecision({ reason: "button", dirty: false, pending: true })).toBe("stay");
    expect(closeDecision({ reason: "dismiss", dirty: true, pending: true })).toBe("stay");
  });
});

describe("shouldDismissSheet", () => {
  it("dismisses after a long drag or a quick flick, not a nudge", () => {
    expect(shouldDismissSheet(120, 0.1)).toBe(true);
    expect(shouldDismissSheet(40, 0.9)).toBe(true);
    expect(shouldDismissSheet(40, 0.2)).toBe(false);
    expect(shouldDismissSheet(10, 2)).toBe(false);
  });
});

describe("AppDialog", () => {
  it("is a bottom sheet below md and a centred dialog from md, from the same markup", () => {
    const html = render(
      <AppDialog open onOpenChange={() => undefined} title="Add expense" footer={<button type="button">Save</button>}>
        Body
      </AppDialog>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('data-part="drag-handle"');
    // Phone: slides up from the bottom; desktop: fades and scales in, centred.
    expect(html).toMatch(/animation-name:sheet-in/);
    expect(html).toMatch(/@media screen and \(min-width: 48rem\)\{[^}]*animation-name:pop-in/);
    expect(html).toMatch(/align-items:flex-end;}@media screen and \(min-width: 48rem\)\{[^{}]*\{[^}]*align-items:center;/);
    // The drag handle shows on phones only.
    expect(html).toMatch(/@media screen and \(min-width: 48rem\)\{[^}]*display:none/);
  });

  it("makes ConfirmDialog a sheet on phones too", () => {
    const html = render(<ConfirmDialog open onOpenChange={() => undefined} title="Delete?" confirmLabel="Delete" onConfirm={() => undefined} />);
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('data-part="drag-handle"');
  });

  it("traps focus inside and gives it back on close", () => {
    const finalFocusEl = () => null;
    const initialFocusEl = () => null;
    render(<AppDialog open onOpenChange={() => undefined} title="T" initialFocusEl={initialFocusEl} finalFocusEl={finalFocusEl} />);
    expect(outermost()).toMatchObject({ trapFocus: true, restoreFocus: true, initialFocusEl, finalFocusEl });
  });

  it("closes a clean form on tap outside or Escape", () => {
    const onOpenChange = vi.fn();
    render(<AppDialog open onOpenChange={onOpenChange} title="T" />);
    const outside = dismissEvent();
    outermost().onInteractOutside(outside);
    expect(outside.preventDefault).not.toHaveBeenCalled();
    outermost().onOpenChange({ open: false });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("asks before a dirty form closes on tap outside or Escape", () => {
    const onOpenChange = vi.fn();
    render(<AppDialog open onOpenChange={onOpenChange} title="T" dirty />);
    const outside = dismissEvent();
    const escape = dismissEvent();
    outermost().onInteractOutside(outside);
    outermost().onEscapeKeyDown(escape);
    expect(outside.preventDefault).toHaveBeenCalled();
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("doesn't close while pending, even from its close button", () => {
    const onOpenChange = vi.fn();
    render(<AppDialog open onOpenChange={onOpenChange} title="T" pending />);
    const escape = dismissEvent();
    outermost().onEscapeKeyDown(escape);
    outermost().onOpenChange({ open: false });
    expect(escape.preventDefault).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("opens and closes on its own when it is given only a trigger", () => {
    const html = render(<AppDialog trigger={<button type="button">Open</button>} title="T" />);
    expect(html).toContain("Open");
    expect(outermost().open).toBe(false);
  });
});
