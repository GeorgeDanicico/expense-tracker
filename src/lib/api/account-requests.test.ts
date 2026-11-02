import { afterEach, describe, expect, it, vi } from "vitest";

import { changeEmail, changePassword, deleteAccount, downloadMyData, signOut, signOutEverywhere } from "./account-requests";

function stubFetch(response: () => Response = () => new Response(null, { status: 204 })) {
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof stubFetch>) {
  const [url, init] = fetchMock.mock.calls[0];
  return { url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
}

afterEach(() => vi.unstubAllGlobals());

describe("changePassword", () => {
  it("sends the current and the new password, never the confirmation", async () => {
    const fetchMock = stubFetch();

    await changePassword({ currentPassword: "old-one", password: "brand-new-1", confirmPassword: "brand-new-1" });

    expect(sent(fetchMock)).toEqual({
      url: "/api/account/password",
      method: "POST",
      body: { currentPassword: "old-one", password: "brand-new-1" },
    });
  });

  it("refuses new passwords that don't match without a request", async () => {
    const fetchMock = stubFetch();

    await expect(changePassword({ currentPassword: "old-one", password: "brand-new-1", confirmPassword: "brand-new-2" })).rejects.toMatchObject({
      status: 422,
      fieldErrors: { confirmPassword: ["The passwords don't match."] },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the server's field error for a wrong current password on", async () => {
    stubFetch(() => Response.json(
      { error: "Check the highlighted details and try again.", fieldErrors: { currentPassword: ["That isn't your current password."] } },
      { status: 422 },
    ));

    await expect(changePassword({ currentPassword: "wrong", password: "brand-new-1", confirmPassword: "brand-new-1" })).rejects.toMatchObject({
      status: 422,
      fieldErrors: { currentPassword: ["That isn't your current password."] },
    });
  });
});

describe("changeEmail", () => {
  it("sends the new address with the current password", async () => {
    const fetchMock = stubFetch();

    await changeEmail({ email: "ana@example.com", currentPassword: "kid-password" });

    expect(sent(fetchMock)).toEqual({
      url: "/api/account/email",
      method: "PATCH",
      body: { email: "ana@example.com", currentPassword: "kid-password" },
    });
  });
});

describe("signing out", () => {
  it("signs this browser out", async () => {
    const fetchMock = stubFetch(() => Response.json({ success: true }));

    await signOut();

    expect(sent(fetchMock)).toMatchObject({ url: "/api/auth", method: "DELETE" });
  });

  it("signs out everywhere with the global scope", async () => {
    const fetchMock = stubFetch(() => Response.json({ success: true }));

    await signOutEverywhere();

    expect(sent(fetchMock)).toMatchObject({ url: "/api/auth?scope=global", method: "DELETE" });
  });

  it("throws the server's message when signing out everywhere fails", async () => {
    stubFetch(() => Response.json({ error: "Unable to sign out. Please try again." }, { status: 500 }));

    await expect(signOutEverywhere()).rejects.toThrow("Unable to sign out. Please try again.");
  });
});

describe("deleteAccount", () => {
  it("sends the current password and the typed phrase", async () => {
    const fetchMock = stubFetch();

    await deleteAccount({ currentPassword: "my-password", confirm: "delete my account" });

    expect(sent(fetchMock)).toEqual({
      url: "/api/account",
      method: "DELETE",
      body: { currentPassword: "my-password", confirm: "delete my account" },
    });
  });

  it("passes the server's refusal on", async () => {
    stubFetch(() => Response.json({ error: "You're in a family." }, { status: 409 }));

    await expect(deleteAccount({ currentPassword: "my-password", confirm: "delete my account" })).rejects.toMatchObject({
      status: 409,
      message: "You're in a family.",
    });
  });
});

describe("downloadMyData", () => {
  it("posts to the export and returns the ZIP with the server's file name", async () => {
    const fetchMock = stubFetch(() => new Response(new Uint8Array([80, 75]), {
      status: 200,
      headers: { "content-type": "application/zip", "content-disposition": 'attachment; filename="my-data-2026-11-02.zip"' },
    }));

    const { blob, fileName } = await downloadMyData();

    expect(sent(fetchMock)).toMatchObject({ url: "/api/account/export", method: "POST" });
    expect(fileName).toBe("my-data-2026-11-02.zip");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([80, 75]);
  });

  it("passes the server's refusal on", async () => {
    stubFetch(() => Response.json({ error: "You've downloaded your data a lot recently." }, { status: 429 }));

    await expect(downloadMyData()).rejects.toMatchObject({ status: 429, message: "You've downloaded your data a lot recently." });
  });

  it("says so when the download breaks off", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));

    await expect(downloadMyData()).rejects.toMatchObject({ status: 503 });
  });
});
