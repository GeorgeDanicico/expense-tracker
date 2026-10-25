import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkerLog } from "@/lib/notifications/worker";
import { runWorker } from "@/worker/run";

/** A `process` stand-in: emit "SIGTERM" or "SIGINT" on it; `exit` records its codes. */
function fakeProcess() {
  const emitter = new EventEmitter();
  const exits: number[] = [];
  return { process: Object.assign(emitter, { exit: (code: number) => void exits.push(code) }), emitter, exits };
}

function memoryLog() {
  const events: string[] = [];
  const log: WorkerLog = { info: (event) => events.push(event), error: (event) => events.push(event) };
  return { log, events };
}

/** A tick that stays running until `finish()` is called. */
function pendingTick() {
  let finish = () => {};
  const promise = new Promise<void>((resolve) => (finish = resolve));
  return { promise, finish: () => finish() };
}

describe("runWorker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks at once and then every interval", async () => {
    const { process } = fakeProcess();
    const { log } = memoryLog();
    const tick = vi.fn(async () => {});

    runWorker({ tick, intervalMs: 30_000, log, process });
    await vi.advanceTimersByTimeAsync(0);
    expect(tick).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(29_999);
    expect(tick).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(tick).toHaveBeenCalledTimes(4);
  });

  it("on SIGTERM while waiting, stops at once without another tick and exits with 0", async () => {
    const { process, emitter, exits } = fakeProcess();
    const { log, events } = memoryLog();
    const tick = vi.fn(async () => {});

    const stopped = runWorker({ tick, intervalMs: 30_000, log, process });
    await vi.advanceTimersByTimeAsync(10_000);
    emitter.emit("SIGTERM");
    await stopped;
    await vi.advanceTimersByTimeAsync(0);

    expect(tick).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([0]);
    expect(events).toEqual(["stopping", "stopped"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("on SIGINT during a tick, lets the tick finish before exiting", async () => {
    const { process, emitter, exits } = fakeProcess();
    const { log } = memoryLog();
    const running = pendingTick();
    const tick = vi.fn(() => running.promise);

    runWorker({ tick, intervalMs: 30_000, log, process });
    await vi.advanceTimersByTimeAsync(0);
    emitter.emit("SIGINT");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(exits).toEqual([]);

    running.finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(exits).toEqual([0]);
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("exits with 1 on a second signal while the tick is still running", async () => {
    const { process, emitter, exits } = fakeProcess();
    const { log, events } = memoryLog();
    const running = pendingTick();

    runWorker({ tick: () => running.promise, intervalMs: 30_000, log, process });
    await vi.advanceTimersByTimeAsync(0);
    emitter.emit("SIGTERM");
    emitter.emit("SIGTERM");

    expect(exits).toEqual([1]);
    expect(events).toEqual(["stopping", "forced_exit"]);
  });

  it("logs a rejected tick and keeps going", async () => {
    const { process } = fakeProcess();
    const { log, events } = memoryLog();
    const tick = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);

    runWorker({ tick, intervalMs: 30_000, log, process });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(events).toEqual(["tick_failed"]);
    expect(tick).toHaveBeenCalledTimes(2);
  });
});
