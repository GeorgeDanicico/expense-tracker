import { describe, expect, it, vi } from "vitest";

import { renderOrRedirect } from "@/test/redirect";

vi.mock("next/navigation", () => import("@/test/redirect"));

import RootPage from "@/app/page";

describe("the root page", () => {
  it("sends everyone to Home, whose layout signs in whoever isn't", async () => {
    expect((await renderOrRedirect(RootPage)).redirectedTo).toBe("/dashboard");
  });
});
