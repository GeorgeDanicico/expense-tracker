import { ChakraProvider } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import type { MouseEvent, PointerEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionBar } from "@/components/ui/action-bar";
import { AmountInput, currencySymbol, sanitizeAmount } from "@/components/ui/amount-input";
import { Collapse, Disclosure } from "@/components/ui/disclosure";
import { createLongPress, LONG_PRESS, RowActions } from "@/components/ui/row-actions";
import { ledgerSystem } from "@/components/ui/theme";
import { ToggleChip } from "@/components/ui/toggle-chip";
import { createUndoQueue, UNDO_MS, UndoToast } from "@/components/ui/undo-toast";

const render = (element: ReactElement) => renderToStaticMarkup(<ChakraProvider value={ledgerSystem}>{element}</ChakraProvider>);

describe("createUndoQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const onChange = vi.fn();
    const queue = createUndoQueue({ onChange });
    const entry = (message: string) => ({ message, commit: vi.fn(), restore: vi.fn() });
    return { onChange, queue, entry };
  };

  it("sends the write only when the 5 seconds are up", () => {
    const { queue, entry, onChange } = setup();
    const deleted = entry("Expense deleted");
    queue.schedule(deleted);
    expect(onChange).toHaveBeenLastCalledWith(deleted);
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(deleted.commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deleted.commit).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("cancels the write on undo and puts the row back", () => {
    const { queue, entry, onChange } = setup();
    const deleted = entry("Expense deleted");
    queue.schedule(deleted);
    queue.undo();
    vi.advanceTimersByTime(UNDO_MS * 2);
    expect(deleted.commit).not.toHaveBeenCalled();
    expect(deleted.restore).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("sends a waiting write at once when the page is hidden (flush) or another delete follows", () => {
    const { queue, entry } = setup();
    const first = entry("First deleted");
    const second = entry("Second deleted");
    queue.schedule(first);
    queue.schedule(second);
    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(second.commit).not.toHaveBeenCalled();
    queue.flush();
    expect(second.commit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(UNDO_MS);
    queue.undo();
    expect(first.commit).toHaveBeenCalledTimes(1);
    expect(second.commit).toHaveBeenCalledTimes(1);
    expect(second.restore).not.toHaveBeenCalled();
  });
});

describe("UndoToast", () => {
  it("says what happened and offers Undo, politely announced", () => {
    const html = render(<UndoToast message="Expense deleted" onUndo={() => undefined} />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Expense deleted");
    expect(html).toContain(">Undo</button>");
  });

  it("is hidden from everyone when there is nothing to undo", () => {
    expect(render(<UndoToast message={null} onUndo={() => undefined} />)).toContain('aria-hidden="true"');
  });
});

describe("sanitizeAmount", () => {
  it("rejects a third decimal", () => {
    expect(sanitizeAmount("12.345", "12.34")).toBe("12.34");
  });

  it("accepts up to two decimals, a comma as the point, and an empty field", () => {
    expect(sanitizeAmount("12.3", "12.")).toBe("12.3");
    expect(sanitizeAmount("12,5", "12")).toBe("12.5");
    expect(sanitizeAmount(".5", "")).toBe(".5");
    expect(sanitizeAmount("", "4")).toBe("");
    expect(sanitizeAmount("1 250.00", "")).toBe("1250.00");
  });

  it("refuses letters, a sign, a second point and more than nine whole digits", () => {
    expect(sanitizeAmount("12a", "12")).toBe("12");
    expect(sanitizeAmount("-3", "")).toBe("");
    expect(sanitizeAmount("1.2.3", "1.2")).toBe("1.2");
    expect(sanitizeAmount("1234567890", "123456789")).toBe("123456789");
  });
});

describe("AmountInput", () => {
  it("opens the decimal keypad and shows the account's currency", () => {
    const html = render(<AmountInput currency="EUR" value="12.50" onValueChange={() => undefined} variant="hero" />);
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain('type="text"');
    expect(html).toContain('aria-label="Amount in EUR"');
    expect(html).toContain("€");
    expect(html).toContain('value="12.50"');
  });

  it("works in a form as a field with a name", () => {
    const html = render(<AmountInput currency="GBP" name="amount" defaultValue="3" />);
    expect(html).toContain('name="amount"');
    expect(html).toContain("£");
    expect(html).not.toContain("aria-label=");
  });

  it("names currencies without a symbol by their code", () => {
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("RON")).toBe("RON");
  });
});

describe("createLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const pointer = (x: number, y: number, pointerType = "touch") => ({ clientX: x, clientY: y, pointerType, button: 0 }) as unknown as PointerEvent;
  const click = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as MouseEvent & { preventDefault: ReturnType<typeof vi.fn> };

  it("opens the menu where a finger rests, and swallows the click that follows", () => {
    const onLongPress = vi.fn();
    const press = createLongPress(onLongPress);
    press.onPointerDown(pointer(100, 200));
    press.onPointerMove(pointer(104, 203));
    vi.advanceTimersByTime(LONG_PRESS.delay);
    expect(onLongPress).toHaveBeenCalledWith({ x: 100, y: 200 });
    const after = click();
    press.onClickCapture(after);
    expect(after.preventDefault).toHaveBeenCalled();
    const next = click();
    press.onClickCapture(next);
    expect(next.preventDefault).not.toHaveBeenCalled();
  });

  it("doesn't fire for a scroll, a short tap or a mouse", () => {
    const onLongPress = vi.fn();
    const press = createLongPress(onLongPress);
    press.onPointerDown(pointer(100, 200));
    press.onPointerMove(pointer(100, 230));
    vi.advanceTimersByTime(LONG_PRESS.delay);
    press.onPointerDown(pointer(100, 200));
    press.onPointerUp();
    vi.advanceTimersByTime(LONG_PRESS.delay);
    press.onPointerDown(pointer(100, 200, "mouse"));
    vi.advanceTimersByTime(LONG_PRESS.delay);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});

describe("RowActions", () => {
  it("has a ⋯ menu for phones and labelled hover actions for desktop", () => {
    const html = render(<RowActions label="Weekly groceries" actions={[{ label: "Delete", icon: Trash2, onSelect: () => undefined, tone: "danger" }]} />);
    expect(html).toContain('aria-label="More actions: Weekly groceries"');
    expect(html).toContain('aria-label="Delete: Weekly groceries"');
    expect(html).toContain("data-row-actions");
  });
});

describe("ToggleChip, ActionBar and Disclosure", () => {
  it("makes a chip a toggle button", () => {
    const html = render(<ToggleChip pressed>Groceries</ToggleChip>);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-pressed="true"/);
  });

  it("keeps the action bar at the bottom", () => {
    expect(render(<ActionBar aria-label="Import">Add</ActionBar>)).toMatch(/role="region" aria-label="Import"/);
  });

  it("folds content away and says so", () => {
    const html = render(<Disclosure label="More details">Notes</Disclosure>);
    expect(html).toContain('aria-expanded="false"');
    expect(render(<Collapse open={false}>Row</Collapse>)).toContain('aria-hidden="true"');
  });
});
