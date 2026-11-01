import { describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/client";

import { isPasswordChangeRequired, redirectIfPasswordChangeRequired } from "./password-change";

const refusal = new ApiError("Choose a new password before you keep using the app.", 403, undefined, "password_change_required");

function at(pathname: string) {
  return { pathname, replace: vi.fn() };
}

describe("isPasswordChangeRequired", () => {
  it("is true only for the 403 with the password_change_required code", () => {
    expect(isPasswordChangeRequired(refusal)).toBe(true);
    expect(isPasswordChangeRequired(new ApiError("You don't have access to this.", 403))).toBe(false);
    expect(isPasswordChangeRequired(new ApiError("Unauthorized", 401, undefined, "password_change_required"))).toBe(false);
    expect(isPasswordChangeRequired(new Error("password_change_required"))).toBe(false);
  });
});

describe("redirectIfPasswordChangeRequired", () => {
  it("sends the browser to the change-password page", () => {
    const location = at("/expenses");

    expect(redirectIfPasswordChangeRequired(refusal, location)).toBe(true);
    expect(location.replace).toHaveBeenCalledExactlyOnceWith("/change-password");
  });

  it("stays put on the change-password page, and for any other error", () => {
    const onPage = at("/change-password");
    expect(redirectIfPasswordChangeRequired(refusal, onPage)).toBe(false);
    expect(onPage.replace).not.toHaveBeenCalled();

    const elsewhere = at("/expenses");
    expect(redirectIfPasswordChangeRequired(new ApiError("Unauthorized", 401), elsewhere)).toBe(false);
    expect(elsewhere.replace).not.toHaveBeenCalled();
  });

  it("does nothing outside the browser", () => {
    expect(redirectIfPasswordChangeRequired(refusal, undefined)).toBe(false);
  });
});
