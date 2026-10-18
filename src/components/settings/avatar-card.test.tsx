import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiFormError } from "@/hooks/use-api-form";
import { ledgerSystem } from "@/components/ui/theme";
import { ACCOUNT_AVATAR_API_URL } from "@/lib/api/keys";

import { AvatarCard, avatarName, removeAvatar, uploadAvatar, validateAvatarFile } from "./avatar-card";

// Component tests render static markup (no DOM), so the card's behaviour is tested through the
// helpers it calls: the browser checks, and the requests `uploadAvatar` and `removeAvatar` send.

function file(type: string, size = 1024, name = "me") {
  return new File([new Uint8Array(size)], name, { type });
}

function stubFetch(response: Response = new Response(JSON.stringify({ avatarUrl: "/api/avatars/u/new" }))) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function render(avatarUrl: string | null) {
  return renderToStaticMarkup(
    <ChakraProvider value={ledgerSystem}>
      <AvatarCard email="ana.pop@example.com" avatarUrl={avatarUrl} />
    </ChakraProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("validateAvatarFile", () => {
  it("accepts a JPG or PNG up to 5 MB", () => {
    expect(validateAvatarFile({ type: "image/jpeg", size: 5 * 1024 * 1024 })).toBeNull();
    expect(validateAvatarFile({ type: "image/png", size: 10 })).toBeNull();
  });

  it("refuses other types", () => {
    expect(validateAvatarFile({ type: "image/gif", size: 10 })).toBe("Choose a JPG or PNG image.");
    expect(validateAvatarFile({ type: "", size: 10 })).toBe("Choose a JPG or PNG image.");
  });

  it("refuses a file over 5 MB", () => {
    expect(validateAvatarFile({ type: "image/jpeg", size: 6 * 1024 * 1024 })).toBe("Choose an image under 5 MB.");
  });
});

describe("uploadAvatar", () => {
  it("refuses a GIF in the browser without a request", async () => {
    const fetchMock = stubFetch();
    await expect(uploadAvatar(file("image/gif"))).rejects.toThrow("Choose a JPG or PNG image.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a 6 MB file in the browser without a request", async () => {
    const fetchMock = stubFetch();
    await expect(uploadAvatar(file("image/jpeg", 6 * 1024 * 1024))).rejects.toThrow("Choose an image under 5 MB.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a JPEG as a PUT with the file as the body and its own Content-Type", async () => {
    const fetchMock = stubFetch();
    const jpeg = file("image/jpeg");
    await expect(uploadAvatar(jpeg)).resolves.toEqual({ avatarUrl: "/api/avatars/u/new" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ACCOUNT_AVATAR_API_URL);
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(jpeg);
    expect(init?.headers).toMatchObject({ "Content-Type": "image/jpeg" });
  });

  it("shows the server's message for a 415", async () => {
    stubFetch(new Response(JSON.stringify({ error: "Upload a JPG or PNG image." }), { status: 415 }));
    const caught = await uploadAvatar(file("image/png")).catch((error: unknown) => error);
    // `useApiForm` turns the thrown error into the message the card's InlineAlert shows.
    expect(apiFormError(caught, "fallback").error).toBe("Upload a JPG or PNG image.");
  });
});

describe("removeAvatar", () => {
  it("sends a DELETE", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await removeAvatar();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ACCOUNT_AVATAR_API_URL);
    expect(init?.method).toBe("DELETE");
  });
});

describe("avatarName", () => {
  it("is the email's part before the @", () => {
    expect(avatarName("ana.pop@example.com")).toBe("ana.pop");
  });
});

describe("AvatarCard", () => {
  it("offers an upload, and no Remove, without a picture", () => {
    const html = render(null);
    expect(html).toContain("Profile picture");
    expect(html).toContain("Shown to your family. JPG or PNG, up to 5 MB.");
    expect(html).toContain("Upload picture");
    expect(html).not.toContain("Remove");
    expect(html).not.toContain("<img");
    expect(html).toMatch(/<input[^>]*type="file"[^>]*accept="image\/jpeg,image\/png"/);
  });

  it("shows the picture, and a Remove that opens a confirmation instead of deleting", () => {
    const fetchMock = stubFetch();
    const html = render("/api/avatars/u/old");
    expect(html).toMatch(/<img[^>]*src="\/api\/avatars\/u\/old"/);
    expect(html).toContain("Change picture");
    // Remove is the ConfirmDialog's trigger: it opens the dialog, whose confirm button sends the DELETE.
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*>(?:(?!<\/button>).)*Remove<\/button>/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
