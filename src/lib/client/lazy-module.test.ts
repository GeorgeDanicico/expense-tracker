import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLazyModule, NOTIFY_BATCH } from "@/lib/client/lazy-module";

describe("a lazy lazy's subscribers", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("hear that it arrived in batches, so a few hundred of them don't rebuild their widgets in one block (PF11)", async () => {
    const lazy = createLazyModule(async () => "parts");
    const heard = vi.fn();
    const total = NOTIFY_BATCH * 3 + 5;
    for (let index = 0; index < total; index += 1) lazy.subscribe(() => heard(lazy.get()));

    await lazy.load();
    // The first batch is told at once (a lone subscriber, like a sheet, hears it without a delay) ...
    expect(heard).toHaveBeenCalledTimes(NOTIFY_BATCH);
    // ... and the others one batch per timer, so the browser can answer a tap in between.
    await vi.advanceTimersByTimeAsync(0);
    expect(heard).toHaveBeenCalledTimes(NOTIFY_BATCH * 2);
    await vi.runAllTimersAsync();
    expect(heard).toHaveBeenCalledTimes(total);
    expect(heard).toHaveBeenLastCalledWith("parts");
  });

  it("skips a subscriber that unsubscribed while it waited", async () => {
    const lazy = createLazyModule(async () => "parts");
    const heard: number[] = [];
    const unsubscribes = Array.from({ length: NOTIFY_BATCH + 2 }, (_, index) => lazy.subscribe(() => heard.push(index)));

    await lazy.load();
    expect(heard).toHaveLength(NOTIFY_BATCH);
    unsubscribes[NOTIFY_BATCH]();
    await vi.runAllTimersAsync();
    expect(heard).toEqual([...Array(NOTIFY_BATCH).keys(), NOTIFY_BATCH + 1]);
  });

  it("tells the before-subscribers first and all at once, so the focus can be noted before any swap", async () => {
    const lazy = createLazyModule(async () => "parts");
    const order: string[] = [];
    for (let index = 0; index < NOTIFY_BATCH + 1; index += 1) lazy.subscribeBefore(() => order.push("before"));
    lazy.subscribe(() => order.push("after"));

    await lazy.load();
    expect(order.filter((entry) => entry === "before")).toHaveLength(NOTIFY_BATCH + 1);
    expect(order.indexOf("after")).toBe(NOTIFY_BATCH + 1);
  });
});
