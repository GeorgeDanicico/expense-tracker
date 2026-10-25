import { describe, expect, it } from "vitest";

import { shouldRegisterServiceWorker } from "./pwa-registration";

describe("shouldRegisterServiceWorker", () => {
  it("registers in production", () => {
    expect(shouldRegisterServiceWorker({ NODE_ENV: "production" })).toBe(true);
  });

  it("registers in development only with NEXT_PUBLIC_SW_IN_DEV=true", () => {
    expect(shouldRegisterServiceWorker({ NODE_ENV: "development" })).toBe(false);
    expect(shouldRegisterServiceWorker({ NODE_ENV: "development", NEXT_PUBLIC_SW_IN_DEV: "1" })).toBe(false);
    expect(shouldRegisterServiceWorker({ NODE_ENV: "development", NEXT_PUBLIC_SW_IN_DEV: "true" })).toBe(true);
  });
});
