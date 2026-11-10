import { describe, expect, it, vi } from "vitest";

import { forgetPerRequest, oncePerRequest, runWithRequestMemo } from "@/lib/request-memo";

describe("oncePerRequest", () => {
  it("reads once per key inside a memo, however many callers ask, at the same time or later", async () => {
    const load = vi.fn(async () => ({ name: "The Smiths" }));

    const [first, second, third] = await runWithRequestMemo(async () => {
      const together = await Promise.all([oncePerRequest("family", load), oncePerRequest("family", load)]);
      return [...together, await oncePerRequest("family", load)];
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("keeps keys apart", async () => {
    const answers = await runWithRequestMemo(() => Promise.all([
      oncePerRequest("a", async () => "A"),
      oncePerRequest("b", async () => "B"),
    ]));

    expect(answers).toEqual(["A", "B"]);
  });

  it("reads every time outside a memo", async () => {
    const load = vi.fn(async () => 1);

    await oncePerRequest("family", load);
    await oncePerRequest("family", load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("gives each request its own memo", async () => {
    const load = vi.fn(async () => 1);

    await runWithRequestMemo(() => oncePerRequest("family", load));
    await runWithRequestMemo(() => oncePerRequest("family", load));

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("gives a nested run its own memo, and leaves the outer one as it was (an MCP call acting as another caller)", async () => {
    const load = vi.fn(async () => "outer");

    await runWithRequestMemo(async () => {
      await oncePerRequest("user", load);
      expect(await runWithRequestMemo(() => oncePerRequest("user", async () => "inner"))).toBe("inner");
      expect(await oncePerRequest("user", load)).toBe("outer");
    });

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reads again after the key is forgotten", async () => {
    let version = 0;
    const load = vi.fn(async () => ++version);

    const answers = await runWithRequestMemo(async () => {
      const before = await oncePerRequest("family", load);
      forgetPerRequest("family", "other");
      return [before, await oncePerRequest("family", load), await oncePerRequest("family", load)];
    });

    expect(answers).toEqual([1, 2, 2]);
  });

  it("keeps a failed read failed for the rest of the request", async () => {
    const load = vi.fn(async () => {
      throw new Error("private failure");
    });

    await runWithRequestMemo(async () => {
      await expect(oncePerRequest("family", load)).rejects.toThrow("private failure");
      await expect(oncePerRequest("family", load)).rejects.toThrow("private failure");
    });

    expect(load).toHaveBeenCalledTimes(1);
  });
});
