import { describe, expect, it } from "vitest";

import { noticeMessage, noticeTitle } from "./account-notice-dialog";

describe("noticeMessage", () => {
  it("says the family was deleted and the user's own data is still there", () => {
    expect(noticeMessage({ kind: "family_deleted", familyName: "The Smiths" })).toBe(
      "The family The Smiths was deleted. Your own expenses, investments and net worth are still here.",
    );
  });

  it("says the user was removed and their own data is still there", () => {
    expect(noticeMessage({ kind: "removed_from_family", familyName: "The Smiths" })).toBe(
      "You were removed from the family The Smiths. Your own data is still here.",
    );
  });
});

describe("noticeTitle", () => {
  it("says the family was deleted", () => {
    expect(noticeTitle({ kind: "family_deleted" })).toBe("Your family was deleted");
  });

  it("says the user was removed, not that they left", () => {
    expect(noticeTitle({ kind: "removed_from_family" })).toBe("You were removed from the family");
  });
});
