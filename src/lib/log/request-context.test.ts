import { describe, expect, it } from "vitest";

import { createLogger } from "@/lib/log";
import {
  addRequestFields,
  createRequestContext,
  currentRequest,
  runWithRequestContext,
  setRequestUser,
} from "@/lib/log/request-context";

/** A logger that keeps its lines and reads the request context like the process-wide one. */
function memory() {
  const lines: string[] = [];
  const logger = createLogger({ out: (line) => lines.push(line), err: (line) => lines.push(line), level: "debug" });
  return { logger, lines: () => lines.map((line) => JSON.parse(line)) };
}

describe("createRequestContext", () => {
  it("describes the request: a new id, the method and the route template, never the query", () => {
    const context = createRequestContext(
      new Request("http://localhost/api/todos/6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f/move?token=abc", { method: "post" }),
      42,
    );

    expect(context).toEqual({
      requestId: expect.stringMatching(/^[A-Za-z0-9]{12}$/),
      method: "POST",
      route: "/api/todos/:id/move",
      startedAt: 42,
      spans: [],
      fields: {},
    });
  });

  it("takes the proxy's id only on a path the proxy runs on", () => {
    const headers = { "x-request-id": "Proxy1234567", "x-request-id-source": "proxy" };

    expect(createRequestContext(new Request("http://localhost/api/expenses", { headers })).requestId).toBe("Proxy1234567");
    expect(createRequestContext(new Request("http://localhost/api/mcp", { headers })).requestId).not.toBe("Proxy1234567");
  });

  it("describes a missing request as a GET of an unknown route", () => {
    expect(createRequestContext(undefined)).toMatchObject({ method: "GET", route: "unknown" });
  });
});

describe("the request context", () => {
  it("is undefined outside a request, where the helpers do nothing", () => {
    expect(currentRequest()).toBeUndefined();
    expect(() => {
      setRequestUser("user-1");
      addRequestFields({ familyId: "f" });
    }).not.toThrow();
  });

  it("holds the user and fields a request adds, through awaits", async () => {
    const context = createRequestContext(new Request("http://localhost/api/test"));

    await runWithRequestContext(context, async () => {
      await Promise.resolve();
      setRequestUser("user-1");
      addRequestFields({ familyId: "family-1" });
      addRequestFields({ importId: "import-1", familyId: "family-2" });
      expect(currentRequest()).toBe(context);
    });

    expect(context).toMatchObject({ userId: "user-1", fields: { familyId: "family-2", importId: "import-1" } });
    expect(currentRequest()).toBeUndefined();
  });

  it("adds the request id to every line the shared logger writes inside it", async () => {
    const { logger, lines } = memory();
    const context = createRequestContext(undefined);

    logger.info("outside");
    await runWithRequestContext(context, async () => {
      logger.info("inside");
      await new Promise((resolve) => setTimeout(resolve, 1));
      logger.warn("later", { requestId: "line-wins" });
    });

    expect(lines()).toEqual([
      expect.not.objectContaining({ requestId: expect.anything() }),
      expect.objectContaining({ event: "inside", requestId: context.requestId }),
      expect.objectContaining({ event: "later", requestId: "line-wins" }),
    ]);
  });

  it("keeps concurrent requests apart", async () => {
    const { logger, lines } = memory();
    const a = createRequestContext(undefined);
    const b = createRequestContext(undefined);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

    await Promise.all(
      [a, b].map((context, index) =>
        runWithRequestContext(context, async () => {
          for (let step = 0; step < 3; step += 1) {
            logger.info("step", { index });
            setRequestUser(`user-${index}`);
            await tick();
          }
        }),
      ),
    );

    const written = lines();
    expect(written.map((line) => line.index)).toEqual([0, 1, 0, 1, 0, 1]);
    for (const line of written) expect(line.requestId).toBe([a, b][line.index].requestId);
    expect([a.userId, b.userId]).toEqual(["user-0", "user-1"]);
  });
});
