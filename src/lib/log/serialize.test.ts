import { describe, expect, it } from "vitest";

import { createLogger, errorFields } from "@/lib/log";

/** The error fields as they appear in a written line. */
function written(error: unknown, level: "debug" | "info" = "info") {
  const out: string[] = [];
  createLogger({ out: (line) => out.push(line), level: "debug" }).info("x", errorFields(error, { level }));
  return JSON.parse(out[0]).error;
}

describe("errorFields", () => {
  it("describes an Error by name and message", () => {
    expect(errorFields(new TypeError("bad"))).toEqual({ error: { name: "TypeError", message: "bad" } });
  });

  it("redacts and clips the message", () => {
    const error = errorFields(new Error(`failed for a@b.co ${"x ".repeat(400)}`)).error as { message: string };
    expect(error.message).not.toContain("a@b.co");
    expect(error.message).toHaveLength(500);
  });

  it("keeps a code and a status when it has them", () => {
    const error = Object.assign(new Error("nope"), { code: "ECONNRESET", status: 503 });
    expect(errorFields(error)).toEqual({ error: { name: "Error", message: "nope", code: "ECONNRESET", status: 503 } });
    expect(errorFields(Object.assign(new Error("x"), { statusCode: 404 }))).toEqual({ error: { name: "Error", message: "x", status: 404 } });
  });

  it("leaves out a status that isn't an HTTP status and a code that isn't an error code", () => {
    const error = Object.assign(new Error("nope"), { code: "has spaces and more!", status: "500" });
    expect(errorFields(error)).toEqual({ error: { name: "Error", message: "nope" } });
    expect(errorFields(Object.assign(new Error("x"), { status: 42 }))).toEqual({ error: { name: "Error", message: "x" } });
  });

  it("describes a PostgrestError-shaped object: code, message and hint, never details", () => {
    const postgrest = {
      message: "duplicate key value violates unique constraint",
      details: "Key (email)=(a@b.co) already exists.",
      hint: "Use another value",
      code: "23505",
    };
    const error = errorFields(postgrest).error;
    expect(error).toEqual({ name: "Error", message: "duplicate key value violates unique constraint", hint: "Use another value", code: "23505" });
    expect(JSON.stringify(error)).not.toContain("a@b.co");
  });

  it("describes a PostgrestError class that extends Error the same way", () => {
    class PostgrestError extends Error {
      details = "Key (email)=(a@b.co) already exists.";
      hint = "";
      code = "PGRST116";
      constructor(message: string) {
        super(message);
        this.name = "PostgrestError";
      }
    }
    expect(errorFields(new PostgrestError("JSON object requested, multiple (or no) rows returned"))).toEqual({
      error: { name: "PostgrestError", message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
    });
  });

  it("follows a cause chain two levels deep", () => {
    const error = new Error("top", { cause: new Error("middle", { cause: new Error("bottom", { cause: new Error("too deep") }) }) });
    expect(errorFields(error)).toEqual({
      error: {
        name: "Error",
        message: "top",
        cause: { name: "Error", message: "middle", cause: { name: "Error", message: "bottom" } },
      },
    });
  });

  it("describes a cause that isn't an error", () => {
    const error = new Error("top", { cause: "just text" });
    expect(errorFields(error)).toEqual({
      error: { name: "Error", message: "top", cause: { name: "NonError", message: "just text" } },
    });
  });

  it("writes an AggregateError's errors, at most five", () => {
    const error = new AggregateError(Array.from({ length: 8 }, (_, index) => new Error(`e${index}`)), "many");
    const described = errorFields(error).error as { errors: unknown[] };
    expect(described.errors).toHaveLength(5);
    expect(described.errors[0]).toEqual({ name: "Error", message: "e0" });
  });

  it("turns a thrown value that isn't an error into a NonError", () => {
    expect(errorFields("boom")).toEqual({ error: { name: "NonError", message: "boom" } });
    expect(errorFields(42)).toEqual({ error: { name: "NonError", message: "42" } });
    expect(errorFields(null)).toEqual({ error: { name: "NonError", message: "null" } });
    expect(errorFields(undefined)).toEqual({ error: { name: "NonError", message: "undefined" } });
    expect(errorFields({ a: 1 })).toEqual({ error: { name: "NonError", message: "[object Object]" } });
    expect((errorFields("x ".repeat(150)).error as { message: string }).message).toHaveLength(200);
    expect(errorFields("sent to a@b.co")).toEqual({ error: { name: "NonError", message: "sent to [redacted]" } });
  });

  it("never throws for values that can't be printed or read", () => {
    expect(errorFields(Object.create(null)).error).toMatchObject({ name: "NonError" });
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        getPrototypeOf() {
          throw new Error("trap");
        },
      },
    );
    expect(() => errorFields(hostile)).not.toThrow();
    const throwing = Object.defineProperty(new Error("x"), "code", {
      get() {
        throw new Error("trap");
      },
    });
    expect(errorFields(throwing)).toEqual({ error: { name: "Error", message: "x" } });
  });

  it("includes the stack only at debug level: ten frames, paths relative to the app root", () => {
    const error = new Error("boom");
    error.stack = [
      "Error: boom a@b.co",
      ...Array.from({ length: 14 }, (_, index) => `    at fn${index} (${process.cwd()}/src/lib/thing${index}.ts:1:2)`),
    ].join("\n");

    expect(errorFields(error, { level: "info" }).error).not.toHaveProperty("stack");

    const stack = (errorFields(error, { level: "debug" }).error as { stack: string[] }).stack;
    expect(stack).toHaveLength(10);
    expect(stack[0]).toBe("at fn0 (src/lib/thing0.ts:1:2)");
    expect(JSON.stringify(stack)).not.toContain(process.cwd());
    expect(JSON.stringify(stack)).not.toContain("a@b.co");
  });

  it("reads the default level from LOG_LEVEL", async () => {
    const { vi } = await import("vitest");
    const error = new Error("boom");
    vi.stubEnv("LOG_LEVEL", "debug");
    try {
      expect(errorFields(error).error).toHaveProperty("stack");
    } finally {
      vi.unstubAllEnvs();
    }
    expect(errorFields(error).error).not.toHaveProperty("stack");
  });

  it("survives a line: the written error keeps its code and passes redaction", () => {
    const error = Object.assign(new Error("x"), { code: "23505", status: 409 });
    expect(written(error)).toEqual({ name: "Error", message: "x", code: "23505", status: 409 });
  });

  it("keeps an invite-code-shaped code out of the line", () => {
    expect(written(Object.assign(new Error("x"), { code: "AB23CD45" }))).toEqual({ name: "Error", message: "x", code: "[redacted]" });
  });
});
