import { describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { PositionTakenError } from "@/lib/todos/repository";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { defaultDoneSince, retryOnPositionTaken } from "@/lib/todos/service";

describe("retryOnPositionTaken", () => {
  it("returns the first write that doesn't lose the race", async () => {
    const write = vi.fn()
      .mockRejectedValueOnce(new PositionTakenError())
      .mockRejectedValueOnce(new PositionTakenError())
      .mockResolvedValue("saved");

    expect(await retryOnPositionTaken(write)).toBe("saved");
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("lets the 409 through after three attempts", async () => {
    const write = vi.fn().mockRejectedValue(new PositionTakenError());

    await expect(retryOnPositionTaken(write)).rejects.toMatchObject({ status: 409 });
    expect(write).toHaveBeenCalledTimes(3);
  });

  it("never retries another error", async () => {
    const write = vi.fn().mockRejectedValue(new DomainError("Nope.", 422));

    await expect(retryOnPositionTaken(write)).rejects.toMatchObject({ status: 422 });
    expect(write).toHaveBeenCalledOnce();
  });
});

describe("defaultDoneSince", () => {
  it("is 30 days before now", () => {
    expect(defaultDoneSince(new Date("2026-10-24T12:00:00.000Z"))).toBe("2026-09-24T12:00:00.000Z");
  });
});
