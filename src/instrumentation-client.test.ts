import { z } from "zod";
import { describe, expect, it } from "vitest";

describe("instrumentation-client", () => {
  it("turns off Zod's eval probe in the browser, so the CSP sees no eval", async () => {
    expect(z.config().jitless).toBeFalsy();
    await import("@/instrumentation-client");
    expect(z.config().jitless).toBe(true);
  });
});
