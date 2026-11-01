import { NextRequest } from "next/server";
import { vi } from "vitest";

import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";

/**
 * Route tests mock `@/lib/auth` with `vi.mock("@/lib/auth", () => ({ getAuthenticatedUser: vi.fn() }))`;
 * `signedInAs` then decides who the wrapper sees.
 */
export const testUser: AuthenticatedUser = { id: "10000000-0000-4000-8000-000000000001", email: "owner@example.test" };

export function signedInAs(user: AuthenticatedUser = testUser) {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(user);
  return user;
}

type CallOptions<Params> = {
  method?: string;
  /** Path and query, resolved against http://localhost. */
  url?: string;
  /** Sent as JSON; a string is sent as-is. Either way it goes as `Content-Type: application/json`, like `apiRequest`. */
  body?: unknown;
  /** Extra request headers, such as `X-Forwarded-For`, or a `Content-Type` that replaces the JSON one. */
  headers?: Record<string, string>;
  params?: Params;
};

/** Calls a route handler like Next does and returns its status, headers and parsed JSON body (null when not JSON). */
export async function callRoute<Params = Record<string, string>>(
  handler: (request: NextRequest, context: { params: Promise<Params> }) => Promise<Response>,
  { method = "GET", url = "/api", body, headers, params }: CallOptions<Params> = {},
) {
  const requestHeaders = new Headers(body === undefined ? {} : { "content-type": "application/json" });
  for (const [name, value] of Object.entries(headers ?? {})) requestHeaders.set(name, value);
  const request = new NextRequest(new URL(url, "http://localhost"), {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve(params ?? ({} as Params)) });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  return { status: response.status, headers: response.headers, body: isJson ? await response.json() : null };
}
