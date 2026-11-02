import { describe, expect, it, vi } from "vitest";

import { createRequestContext, runWithRequestContext } from "@/lib/log/request-context";
import { createTracedFetch, supabaseSpanName } from "@/lib/log/traced-fetch";

const BASE = "https://abcdefghijklmnop.supabase.co";
const UUID = "6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f";

function name(path: string, method?: string) {
  return supabaseSpanName(`${BASE}${path}`, method ? { method } : undefined);
}

describe("supabaseSpanName", () => {
  it.each([
    ["/rest/v1/rpc/move_todo", "POST", "rpc.move_todo"],
    ["/rest/v1/rpc/create_net_worth_item_with_valuation", "POST", "rpc.create_net_worth_item_with_val…"],
    ["/rest/v1/expenses?select=*&user_id=eq.6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f&email=eq.someone%40example.test", undefined, "db.expenses.get"],
    ["/rest/v1/notifications?select=id&status=eq.pending", "HEAD", "db.notifications.head"],
    ["/rest/v1/expenses", "POST", "db.expenses.post"],
    ["/rest/v1/todos?id=eq.6c3f4a8e-2b1d-4c5e-9f70-1a2b3c4d5e6f", "PATCH", "db.todos.patch"],
    ["/rest/v1/mcp_tokens?token_hash=eq.abc", "DELETE", "db.mcp_tokens.delete"],
    ["/rest/v1/", "GET", "supabase.other"],
    ["/rest/v1/rpc", "POST", "supabase.other"],
    ["/rest/v1/some%20table", "GET", "db.:value.get"],
    ["/auth/v1/token?grant_type=password", "POST", "auth.token"],
    ["/auth/v1/user", "GET", "auth.user"],
    ["/auth/v1/logout?scope=global", "POST", "auth.logout"],
    ["/auth/v1/.well-known/jwks.json", "GET", "auth.well-known.jwks.json"],
    [`/auth/v1/admin/users/${UUID}`, "PUT", "auth.admin.users.:id"],
    [`/auth/v1/admin/users/${UUID}/factors/short1`, "DELETE", "auth.admin.users.:id.factors.:id"],
    ["/auth/v1/admin/users?page=2&per_page=50", "GET", "auth.admin.users"],
    ["/auth/v1/admin/generate_link", "POST", "auth.admin.generate_link"],
    ["/auth/v1/oauth/authorizations/abc123", "GET", "auth.oauth.authorizations.:id"],
    ["/auth/v1/oauth/authorizations/abc123/consent", "POST", "auth.oauth.authorizations.:id.consent"],
    ["/auth/v1/admin/oauth/clients/client9/regenerate_secret", "POST", "auth.admin.oauth.clients.:id.regenerate_secret"],
    ["/auth/v1/passkeys/authentication/options", "POST", "auth.passkeys.authentication.options"],
    ["/auth/v1/user/identities/authorize", "GET", "auth.user.identities.authorize"],
    ["/auth/v1/verify?token=abc&type=signup", "GET", "auth.verify"],
    [`/storage/v1/object/avatars/${UUID}/avatar.webp`, "GET", "storage.avatars"],
    [`/storage/v1/object/avatars`, "DELETE", "storage.avatars"],
    [`/storage/v1/object/public/avatars/${UUID}.png`, "GET", "storage.avatars"],
    [`/storage/v1/object/upload/sign/avatars/${UUID}.png?token=abc`, "PUT", "storage.avatars"],
    [`/storage/v1/object/sign/avatars/${UUID}.png`, "POST", "storage.avatars"],
    ["/storage/v1/object/list/avatars", "POST", "storage.avatars"],
    [`/storage/v1/render/image/authenticated/avatars/${UUID}.png?width=64`, "GET", "storage.avatars"],
    ["/storage/v1/object/move", "POST", "storage.move"],
    ["/storage/v1/bucket", "GET", "storage.bucket"],
    [`/storage/v1/object/${UUID}/file.png`, "GET", "storage.:id"],
    ["/storage/v1/", "GET", "supabase.other"],
    ["/functions/v1/hello", "POST", "supabase.other"],
    ["/realtime/v1/api/broadcast", "POST", "supabase.other"],
  ])("names %s (%s) %s", (path, method, expected) => {
    expect(name(path, method)).toBe(expected);
  });

  it("never lets a query string, a filter value or a path value into a name", () => {
    const paths = [
      "/rest/v1/profiles?email=eq.someone%40example.test&select=id",
      `/auth/v1/token?grant_type=password&refresh_token=${["opaque", "value"].join("-")}`,
      `/auth/v1/admin/users/${UUID}`,
      `/storage/v1/object/avatars/${UUID}/private-name.webp`,
      "/auth/v1/oauth/authorizations/Q2xpZW50SWQ",
    ];
    for (const path of paths) {
      const spanName = name(path, "GET");
      for (const leaked of ["?", "=", "@", "someone", "example", "opaque", UUID, "private-name", "Q2xpZW50SWQ"]) {
        expect(spanName).not.toContain(leaked);
      }
    }
  });

  it("reads the URL and method of a URL or a Request", () => {
    expect(supabaseSpanName(new URL(`${BASE}/rest/v1/expenses?id=eq.1`), { method: "DELETE" })).toBe("db.expenses.delete");
    expect(supabaseSpanName(new Request(`${BASE}/rest/v1/expenses`, { method: "PATCH" }))).toBe("db.expenses.patch");
  });

  it("works under a path prefix (a self-hosted gateway)", () => {
    expect(supabaseSpanName("https://example.test/supabase/rest/v1/todos")).toBe("db.todos.get");
  });

  it("names anything unreadable supabase.other", () => {
    expect(supabaseSpanName("not a url")).toBe("supabase.other");
    expect(supabaseSpanName(`${BASE}/rest/v1/expenses`, { method: "WEIRD METHOD" })).toBe("db.expenses.other");
  });
});

describe("createTracedFetch", () => {
  function inContext<T>(fn: () => Promise<T>) {
    const context = createRequestContext(new Request("http://localhost/api/test"));
    return runWithRequestContext(context, fn).then((result) => ({ result, spans: context.spans, context }));
  }

  it("passes the arguments through untouched and returns the very same response", async () => {
    const response = new Response("[]", { status: 200 });
    const inner = vi.fn<typeof fetch>(async () => response);
    const traced = createTracedFetch(inner);
    const init = { method: "GET", headers: { apikey: "key", Authorization: "Bearer jwt" } };
    const url = `${BASE}/rest/v1/expenses?select=*`;

    const { result, spans } = await inContext(() => traced(url, init));

    expect(result).toBe(response);
    expect(inner).toHaveBeenCalledExactlyOnceWith(url, init);
    expect(inner.mock.calls[0][1]).toBe(init);
    expect(spans).toEqual([{ name: "db.expenses.get", ms: expect.any(Number) }]);
  });

  it("passes a single argument as a single argument", async () => {
    const inner = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const request = new Request(`${BASE}/rest/v1/expenses`, { method: "DELETE" });

    const { spans } = await inContext(() => createTracedFetch(inner)(request));

    expect(inner.mock.calls[0]).toEqual([request]);
    expect(inner.mock.calls[0][0]).toBe(request);
    expect(spans).toEqual([{ name: "db.expenses.delete", ms: expect.any(Number) }]);
  });

  it("adds the status of an answer of 400 or more", async () => {
    const traced = createTracedFetch(async () => new Response("{}", { status: 409 }));
    const { result, spans } = await inContext(() => traced(`${BASE}/rest/v1/rpc/move_todo`, { method: "POST" }));

    expect(result.status).toBe(409);
    expect(spans).toEqual([{ name: "rpc.move_todo", ms: expect.any(Number), status: 409 }]);
  });

  it("records a failed call with error and rethrows the very error", async () => {
    const error = new TypeError("fetch failed");
    const traced = createTracedFetch(async () => {
      throw error;
    });
    const context = createRequestContext(undefined);

    await expect(runWithRequestContext(context, () => traced(`${BASE}/auth/v1/user`))).rejects.toBe(error);
    expect(context.spans).toEqual([{ name: "auth.user", ms: expect.any(Number), error: true }]);
  });

  it("counts its calls into dbMs and dbCalls", async () => {
    const traced = createTracedFetch(async () => new Response("[]"));
    const { context } = await inContext(async () => {
      await traced(`${BASE}/rest/v1/expenses`);
      await traced(`${BASE}/auth/v1/user`);
    });
    expect(context.spanTotals).toMatchObject({ dbCalls: 2 });
  });

  it("only calls through outside a request", async () => {
    const response = new Response("[]");
    const inner = vi.fn(async () => response);

    expect(await createTracedFetch(inner)(`${BASE}/rest/v1/expenses`)).toBe(response);
    expect(inner).toHaveBeenCalledOnce();
  });

  it("uses the global fetch by default, looked up at call time", async () => {
    const response = new Response("[]");
    const stub = vi.fn(async () => response);
    vi.stubGlobal("fetch", stub);
    try {
      const traced = createTracedFetch();
      const { result, spans } = await inContext(() => traced(`${BASE}/rest/v1/todos`));
      expect(result).toBe(response);
      expect(stub).toHaveBeenCalledOnce();
      expect(spans).toEqual([{ name: "db.todos.get", ms: expect.any(Number) }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
