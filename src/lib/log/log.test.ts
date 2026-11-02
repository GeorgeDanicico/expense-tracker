import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createLogger, isEventName, log, parseLogLevel, setLogContext } from "@/lib/log";

const NOW = new Date("2026-10-25T09:00:00.000Z");

/** A logger that keeps its stdout and stderr lines. */
function memory(options: Parameters<typeof createLogger>[0] = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const logger = createLogger({ out: (line) => out.push(line), err: (line) => err.push(line), now: () => NOW, level: "debug", ...options });
  return { logger, out, err };
}

describe("createLogger", () => {
  it("writes one JSON line with time, level and event first, then the fields in order", () => {
    const { logger, out } = memory();
    logger.info("tick", { dueNotifications: 1, ms: 12 });
    expect(out).toEqual(['{"time":"2026-10-25T09:00:00.000Z","level":"info","event":"tick","dueNotifications":1,"ms":12}\n']);
  });

  it("sends debug and info to out and warn and error to err", () => {
    const { logger, out, err } = memory();
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(out.map((line) => JSON.parse(line).event)).toEqual(["a", "b"]);
    expect(err.map((line) => JSON.parse(line).event)).toEqual(["c", "d"]);
  });

  it("writes only lines at or above the level, and serialises nothing below it", () => {
    const { logger, out, err } = memory({ level: "warn" });
    const poisoned = {
      get boom(): string {
        throw new Error("read");
      },
    };
    const read = vi.spyOn(poisoned, "boom", "get");
    logger.debug("a", poisoned);
    logger.info("b", poisoned);
    logger.warn("c");
    logger.error("d");
    expect(read).not.toHaveBeenCalled();
    expect(out).toEqual([]);
    expect(err.map((line) => JSON.parse(line).event)).toEqual(["c", "d"]);
  });

  it("takes the default level from LOG_LEVEL", () => {
    vi.stubEnv("LOG_LEVEL", "error");
    try {
      const out: string[] = [];
      const err: string[] = [];
      const logger = createLogger({ out: (l) => out.push(l), err: (l) => err.push(l) });
      logger.info("a");
      logger.warn("b");
      logger.error("c");
      expect([out.length, err.length]).toEqual([0, 1]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("defaults to info", () => {
    vi.stubEnv("LOG_LEVEL", "");
    try {
      const out: string[] = [];
      const logger = createLogger({ out: (l) => out.push(l) });
      logger.debug("a");
      logger.info("b");
      expect(out).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("drops undefined fields", () => {
    const { logger, out } = memory();
    logger.info("x", { a: 1, b: undefined, c: { d: undefined, e: 2 } as never });
    expect(JSON.parse(out[0])).toEqual({ time: NOW.toISOString(), level: "info", event: "x", a: 1, c: { e: 2 } });
  });

  it("doesn't let fields replace time, level or event", () => {
    const { logger, out } = memory();
    logger.info("real", { time: "x", level: "error", event: "fake", extra: true });
    expect(out[0]).toBe('{"time":"2026-10-25T09:00:00.000Z","level":"info","event":"real","extra":true}\n');
  });

  it("writes an event name that isn't snake_case with an invalid_event: prefix, never throwing", () => {
    const { logger, out } = memory();
    logger.info("Bad Name");
    logger.info("a ".repeat(50));
    logger.info("");
    expect(JSON.parse(out[0]).event).toBe("invalid_event:Bad Name");
    expect(JSON.parse(out[1]).event).toBe(`invalid_event:${"a ".repeat(50)}`);
    expect(JSON.parse(out[2]).event).toBe("invalid_event:");
  });

  it("child loggers add their fields to every line, and the line's own fields win", () => {
    const { logger, out } = memory({ base: { service: "web" } });
    const child = logger.child({ familyId: "f1" }).child({ job: "tick" });
    child.info("x", { job: "other", n: 1 });
    logger.info("y");
    expect(JSON.parse(out[0])).toMatchObject({ service: "web", familyId: "f1", job: "other", n: 1 });
    expect(JSON.parse(out[1])).not.toHaveProperty("familyId");
  });

  it("adds the context's fields to every line, from the option or from setLogContext", () => {
    const own = memory({ context: () => ({ requestId: "abc123" }) });
    own.logger.info("x", { n: 1 });
    expect(own.out[0]).toBe('{"time":"2026-10-25T09:00:00.000Z","level":"info","event":"x","requestId":"abc123","n":1}\n');

    setLogContext(() => ({ requestId: "global1" }));
    try {
      const global = memory();
      global.logger.info("x");
      expect(JSON.parse(global.out[0]).requestId).toBe("global1");
    } finally {
      setLogContext(undefined);
    }
    const none = memory();
    none.logger.info("x");
    expect(JSON.parse(none.out[0])).not.toHaveProperty("requestId");
  });

  it("never throws: unserialisable fields, a failing context, clock or write", () => {
    const { logger, out } = memory();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => logger.info("x", { big: 10n as never, cycle: cycle as never })).not.toThrow();
    expect(JSON.parse(out[0])).toMatchObject({ big: "[unserializable]", cycle: { self: "[unserializable]" } });

    const broken = createLogger({
      out: () => {
        throw new Error("EPIPE");
      },
      now: () => {
        throw new Error("clock");
      },
      context: () => {
        throw new Error("context");
      },
    });
    expect(() => broken.info("x")).not.toThrow();
    expect(() => createLogger({ out: () => { throw new Error("EPIPE"); } }).info("x")).not.toThrow();
  });

  it("redacts the fields it writes", () => {
    const { logger, out } = memory();
    logger.info("x", { email: "a@b.co", note: "mail a@b.co" });
    expect(out[0]).not.toContain("a@b.co");
  });
});

describe("log", () => {
  it("is a process-wide logger", () => {
    expect(typeof log.info).toBe("function");
    expect(typeof log.child).toBe("function");
  });
});

describe("isEventName", () => {
  it("accepts snake_case names up to 64 characters", () => {
    for (const name of ["tick", "csp_violation", "a1_b2", "a".repeat(64)]) expect(isEventName(name), name).toBe(true);
    for (const name of ["", "Tick", "1tick", "tick-done", "tick done", "_tick", "a".repeat(65)]) expect(isEventName(name), name).toBe(false);
  });
});

describe("parseLogLevel", () => {
  it("reads the four levels in any case and falls back to info", () => {
    expect(parseLogLevel("debug")).toBe("debug");
    expect(parseLogLevel(" Warn ")).toBe("warn");
    expect(parseLogLevel("ERROR")).toBe("error");
    expect(parseLogLevel("info")).toBe("info");
    for (const bad of [undefined, "", "trace", "toString", "constructor"]) expect(parseLogLevel(bad), String(bad)).toBe("info");
  });
});

describe("import rules", () => {
  it("imports nothing from next or server-only, so the worker bundle and client code can use it", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    for (const file of ["index.ts", "level.ts", "redact.ts", "serialize.ts", "types.ts"]) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/from\s+["'](next(\/|["'])|server-only)/);
      expect(source, file).not.toMatch(/import\s+["']server-only["']/);
      expect(source, file).not.toMatch(/@\/lib\/env/);
    }
  });
});
