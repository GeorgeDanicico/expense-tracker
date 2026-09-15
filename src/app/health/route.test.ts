import { describe, expect, it } from "vitest";

import { GET } from "@/app/health/route";

describe("health route", () => {
  it("reports that the application is healthy without caching the response", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(await response.json()).toEqual({ status: "ok" });
  });
});
