import { describe, expect, it } from "vitest";

import { lastActiveLabel } from "./last-active-label";

const now = new Date("2026-10-16T12:00:00Z");

describe("lastActiveLabel", () => {
  it("says never when there is no activity", () => {
    expect(lastActiveLabel(null, now)).toBe("Never");
    expect(lastActiveLabel(undefined, now)).toBe("Never");
  });

  it("says just now for the last few minutes, and for a time slightly in the future", () => {
    expect(lastActiveLabel("2026-10-16T11:55:00Z", now)).toBe("Just now");
    expect(lastActiveLabel("2026-10-16T12:00:30Z", now)).toBe("Just now");
  });

  it("counts minutes under an hour", () => {
    expect(lastActiveLabel("2026-10-16T11:30:00Z", now)).toBe("30 minutes ago");
  });

  it("counts hours under a day", () => {
    expect(lastActiveLabel("2026-10-16T09:00:00Z", now)).toBe("3 hours ago");
    expect(lastActiveLabel("2026-10-16T10:30:00Z", now)).toBe("1 hour ago");
  });

  it("shows the date for older activity", () => {
    expect(lastActiveLabel("2026-10-12T08:00:00Z", now)).toBe("12 Oct");
  });

  it("adds the year when it is not the current one", () => {
    expect(lastActiveLabel("2025-10-12T08:00:00Z", now)).toBe("12 Oct 2025");
  });

  it("says never for an unreadable date", () => {
    expect(lastActiveLabel("nope", now)).toBe("Never");
  });
});
