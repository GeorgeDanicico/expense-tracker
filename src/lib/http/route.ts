import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";
import { touchLastActiveInBackground } from "@/lib/family/last-active";
import { readBodyWithLimit } from "@/lib/http/body";
import { HttpError } from "@/lib/http/errors";
import { refuseForeignRequest } from "@/lib/http/guard";
import { ImportError } from "@/lib/imports/types";
import { idSchema } from "@/lib/validation/primitives";

/** Every API response is per-user data and must never be cached by browsers or proxies. */
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;

export { HttpError };

type FieldErrors = Record<string, string[] | undefined>;

/** JSON response that always carries the private no-store header. */
export function json(body: unknown, init: number | ResponseInit = {}) {
  const { headers, ...rest } = typeof init === "number" ? { status: init } : init;
  const merged = new Headers(headers);
  for (const [key, value] of Object.entries(PRIVATE_HEADERS)) merged.set(key, value);
  return NextResponse.json(body, { ...rest, headers: merged });
}

export function noContent() {
  return new NextResponse(null, { status: 204, headers: PRIVATE_HEADERS });
}

export function unauthorized() {
  return json({ error: "Unauthorized" }, 401);
}

/** A 429 with `{ error }` and a `Retry-After` of `retryAfterSeconds` (from a limiter's `retryAfterSeconds`). */
export function tooManyRequests(error: string, retryAfterSeconds: number) {
  return json({ error }, { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } });
}

export function notFound(message: string): never {
  throw new HttpError(404, message);
}

/** Validates a route identifier, throwing a 400 with `message` when it is not a UUID. */
export function parseId(id: string, message: string) {
  if (!idSchema().safeParse(id).success) throw new HttpError(400, message);
  return id;
}

/** Validates already-read input, throwing a 422 with `message` and the schema's field errors. */
export function parseInput<S extends z.ZodType>(input: unknown, schema: S, message: string): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, message, parsed.error.flatten().fieldErrors as FieldErrors);
  return parsed.data;
}

/** The largest JSON body `readJson` reads by default. Avatar and statement uploads have their own limits. */
export const JSON_BODY_MAX_BYTES = 64 * 1024;
export const BODY_TOO_LARGE = "The request is too large.";
export const NOT_JSON = "Send the request body as JSON (Content-Type: application/json).";

/** Whether a `Content-Type` is `application/json`, with or without parameters such as `charset`. */
export function isJsonContentType(contentType: string | null) {
  return contentType?.split(";")[0].trim().toLowerCase() === "application/json";
}

/**
 * The request's JSON body, or `null` when it is empty or malformed. A non-empty body must be sent
 * as `application/json` (415 otherwise): a page on another site can only send `text/plain`,
 * form-encoded or multipart bodies without a CORS preflight, so this keeps every JSON route out of
 * reach of a plain HTML form or `no-cors` fetch. More than `maxBytes` (64 KB unless a route needs
 * more) is a 413, counted while reading, not trusted from `Content-Length`. An empty body (a
 * `DELETE` or `POST` with nothing to say) is `null` whatever its type.
 */
export async function readJson(request: Request, { maxBytes = JSON_BODY_MAX_BYTES }: { maxBytes?: number } = {}): Promise<unknown> {
  const bytes = await readBodyWithLimit(request, maxBytes, BODY_TOO_LARGE);
  if (bytes.byteLength === 0) return null;
  if (!isJsonContentType(request.headers.get("content-type"))) throw new HttpError(415, NOT_JSON);
  try {
    // Like `request.json()`: UTF-8, with a leading byte-order mark dropped.
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

export async function parseBody<S extends z.ZodType>(request: Request, schema: S, message: string) {
  return parseInput(await readJson(request), schema, message);
}

/**
 * Next always passes both arguments and type-checks the last signature at build time; the shorter
 * ones let handlers that ignore their arguments be called directly in tests.
 */
export type RouteHandler<Req, Ctx> = {
  (): Promise<Response>;
  (request: Req): Promise<Response>;
  (request: Req, context: Ctx): Promise<Response>;
};

function errorResponse(error: HttpError | DomainError | ImportError) {
  // A refused statement carries the `code` the import screen tells refusals apart by, and no field errors.
  if (error instanceof ImportError) return json({ error: error.message, code: error.code }, error.status);
  return json({ error: error.message, fieldErrors: error.fieldErrors }, error.status);
}

/**
 * Runs the request guard (`refuseForeignRequest`: a write from another site is a 403) and maps an
 * `HttpError` to its response, for the routes that don't sign the caller in through `withUser`
 * (`/api/auth`). Any other error propagates.
 */
export function withRequestGuard<Req extends Request = Request, Ctx = unknown>(
  handler: (request: Req, context: Ctx) => Promise<Response>,
): RouteHandler<Req, Ctx> {
  return async (request?: Req, context?: Ctx): Promise<Response> => {
    const refused = refuseForeignRequest(request);
    if (refused) return errorResponse(refused);
    try {
      return await handler(request as Req, context as Ctx);
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error);
      throw error;
    }
  };
}

/**
 * Wraps a route handler with the request guard, authentication and error mapping:
 * a write from another site → 403 before the session is even read (`refuseForeignRequest`),
 * no user → 401, `HttpError`/`DomainError` → their status, `ImportError` → its status with `{ error, code }`,
 * anything else → 500 with `failure`.
 * Without `failure`, unexpected errors propagate to Next's default error response.
 * While the family flag is on, it also records the user's last activity in the background
 * (`touchLastActiveInBackground`), which never delays or changes the response.
 */
export function withUser<Req extends Request = Request, Ctx = unknown>(
  handler: (request: Req, user: AuthenticatedUser, context: Ctx) => Promise<Response>,
  options: { failure?: string } = {},
): RouteHandler<Req, Ctx> {
  return async (request?: Req, context?: Ctx): Promise<Response> => {
    const refused = refuseForeignRequest(request);
    if (refused) return errorResponse(refused);

    const user = await getAuthenticatedUser();
    if (!user) return unauthorized();
    touchLastActiveInBackground(user.id);

    try {
      return await handler(request as Req, user, context as Ctx);
    } catch (error) {
      if (error instanceof HttpError || error instanceof DomainError || error instanceof ImportError) return errorResponse(error);
      if (options.failure === undefined) throw error;
      return json({ error: options.failure }, 500);
    }
  };
}
