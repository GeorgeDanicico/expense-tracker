import { describe, expect, it } from "vitest";

import { createJsonLog } from "@/worker/log";

describe("createJsonLog", () => {
  it("writes one JSON line per event, info to out and errors to err", () => {
    const out: string[] = [];
    const err: string[] = [];
    const log = createJsonLog({
      out: (line) => out.push(line),
      err: (line) => err.push(line),
      now: () => new Date("2026-10-25T09:00:00.000Z"),
    });

    log.info("tick", { dueNotifications: 1, dueReminders: 0 });
    log.error("tick_failed", { error: "boom" });

    expect(out).toEqual(['{"time":"2026-10-25T09:00:00.000Z","level":"info","event":"tick","dueNotifications":1,"dueReminders":0}\n']);
    expect(err).toEqual(['{"time":"2026-10-25T09:00:00.000Z","level":"error","event":"tick_failed","error":"boom"}\n']);
  });
});
