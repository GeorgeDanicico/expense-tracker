import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getAuthenticatedUser, type AuthenticatedUser } from "@/lib/auth";
import { DomainError } from "@/lib/errors";

/** Every API response is per-user data and must never be cached by browsers or proxies. */
export const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" } as const;

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

/** An expected request failure. `withUser` turns it into `{ error, fieldErrors? }` with its status. */
export class HttpError extends Error {
  readonly status: 400 | 404 | 422;
  readonly fieldErrors?: FieldErrors;

  constructor(status: 400 | 404 | 422, message: string, fieldErrors?: FieldErrors) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

export function notFound(message: string): never {
  throw new HttpError(404, message);
}

const idSchema = z.uuid();

/** Validates a route identifier, throwing a 400 with `message` when it is not a UUID. */
export function parseId(id: string, message: string) {
  if (!idSchema.safeParse(id).success) throw new HttpError(400, message);
  return id;
}

/** Validates already-read input, throwing a 422 with `message` and the schema's field errors. */
export function parseInput<S extends z.ZodType>(input: unknown, schema: S, message: string): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new HttpError(422, message, parsed.error.flatten().fieldErrors as FieldErrors);
  return parsed.data;
}

/** The request's JSON body, or `null` when it is missing or malformed. */
export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

export async function parseBody<S extends z.ZodType>(request: Request, schema: S, message: string) {
  return parseInput(await readJson(request), schema, message);
}

/**
 * Next always passes both arguments and type-checks the last signature at build time; the shorter
 * ones let handlers that ignore their arguments be called directly in tests.
 */
type RouteHandler<Req, Ctx> = {
  (): Promise<Response>;
  (request: Req): Promise<Response>;
  (request: Req, context: Ctx): Promise<Response>;
};

function errorResponse(error: HttpError | DomainError) {
  return json({ error: error.message, fieldErrors: error.fieldErrors }, error.status);
}

/**
 * Wraps a route handler with authentication and error mapping:
 * no user → 401, `HttpError`/`DomainError` → their status, anything else → 500 with `failure`.
 * Without `failure`, unexpected errors propagate to Next's default error response.
 */
export function withUser<Req extends Request = Request, Ctx = unknown>(
  handler: (request: Req, user: AuthenticatedUser, context: Ctx) => Promise<Response>,
  options: { failure?: string } = {},
): RouteHandler<Req, Ctx> {
  return async (request?: Req, context?: Ctx): Promise<Response> => {
    const user = await getAuthenticatedUser();
    if (!user) return unauthorized();

    try {
      return await handler(request as Req, user, context as Ctx);
    } catch (error) {
      if (error instanceof HttpError || error instanceof DomainError) return errorResponse(error);
      if (options.failure === undefined) throw error;
      return json({ error: options.failure }, 500);
    }
  };
}
