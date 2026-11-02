import { currentRequest } from "@/lib/log/request-context";
import { routeTemplate } from "@/lib/log/route-template";
import { recordSpan, spanNamePart } from "@/lib/log/span";

/**
 * The `fetch` every Supabase client is given (logging plan, L4), as `global: { fetch: tracedFetch }`.
 * supabase-js hands it to PostgREST, Auth (the admin API and `getClaims`' key fetch included) and
 * Storage, so each of their calls becomes a span in the current request with no change to the
 * repositories.
 *
 * SECURITY: the span name comes from the URL's path alone, never its query string (PostgREST
 * filters carry values such as `email=eq.…`), its headers (the keys and the user's token) or a
 * body. Ids in the path are replaced.
 *
 * It never changes a call: the arguments go to the inner `fetch` as they came, its `Response` (or
 * error) comes back as it was, and naming or recording a span can't throw. The time is until the
 * response's headers arrive; reading the body isn't counted.
 *
 * It imports nothing from `next/*` or `server-only`, so the worker can use it.
 */

/** The name of a call that isn't one of the shapes below. */
export const OTHER_SUPABASE_SPAN = "supabase.other";

/** A table, function or bucket name as PostgREST and Storage take it: letters, digits, `_` and `-`. */
const IDENTIFIER = /^[A-Za-z0-9_-]{1,63}$/;
const METHOD = /^[a-z]{1,10}$/;

/** The Supabase API a path belongs to, and the rest of the path after `/<api>/v1/`. */
const API_PATH = /\/(rest|auth|storage)\/v1(?:\/(.*))?$/;

/**
 * Auth paths whose next segment is an id even when it doesn't look like one (an OAuth
 * authorization id is short and not a UUID), unless it's one of {@link AUTH_FIXED_AFTER_COLLECTION}.
 */
const AUTH_COLLECTIONS: ReadonlySet<string> = new Set([
  "users",
  "factors",
  "passkeys",
  "authorizations",
  "clients",
  "custom-providers",
  "identities",
]);
/** Segments that follow an {@link AUTH_COLLECTIONS} name and are part of the API, not an id. */
const AUTH_FIXED_AFTER_COLLECTION: ReadonlySet<string> = new Set(["authentication", "registration", "authorize"]);

/** Storage path segments between `object/` (or `render/image/`) and the bucket. */
const STORAGE_QUALIFIERS: ReadonlySet<string> = new Set(["public", "sign", "authenticated", "info", "list", "list-v2", "upload"]);
/** Storage calls that name no bucket in the path (it's in the body). */
const STORAGE_BUCKETLESS: ReadonlySet<string> = new Set(["move", "copy"]);

/** `name` when it's an identifier, else `:value`, clipped so the logger keeps it. */
function identifier(name: string): string {
  return IDENTIFIER.test(name) ? spanNamePart(name) : ":value";
}

function restSpanName(segments: readonly string[], method: string): string {
  const [first, second] = segments;
  if (!first) return OTHER_SUPABASE_SPAN;
  if (first === "rpc") return second ? `rpc.${identifier(second)}` : OTHER_SUPABASE_SPAN;
  return `db.${identifier(first)}.${method}`;
}

/** `auth.` and the path with ids replaced as in the request line's route template, its segments joined by `.`. */
function authSpanName(rest: string): string {
  const segments = routeTemplate(`/${rest}`).split("/").filter(Boolean);
  if (segments.length === 0) return OTHER_SUPABASE_SPAN;
  const named = segments.map((segment, index) => {
    const previous = segments[index - 1];
    if (previous !== undefined && AUTH_COLLECTIONS.has(previous) && !AUTH_FIXED_AFTER_COLLECTION.has(segment) && !segment.startsWith(":")) {
      return ":id";
    }
    return segment.startsWith(":") ? segment : spanNamePart(segment.replace(/^\.+/, ""));
  });
  return `auth.${named.join(".")}`;
}

function storageSpanName(segments: readonly string[]): string {
  let index: number;
  if (segments[0] === "object") index = 1;
  else if (segments[0] === "render" && segments[1] === "image") index = 2;
  else if (segments[0] === "bucket") return "storage.bucket";
  else return OTHER_SUPABASE_SPAN;

  while (index < segments.length && STORAGE_QUALIFIERS.has(segments[index])) index += 1;
  const bucket = segments[index];
  if (!bucket) return OTHER_SUPABASE_SPAN;
  if (index === 1 && STORAGE_BUCKETLESS.has(bucket)) return `storage.${bucket}`;
  const template = routeTemplate(`/${bucket}`).slice(1);
  return `storage.${template.startsWith(":") ? template : identifier(bucket)}`;
}

/** The URL and method of a `fetch` call, whichever form its arguments take. */
function callOf(input: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1]): { url: string; method: string } {
  const isRequest = typeof Request !== "undefined" && input instanceof Request;
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : isRequest ? input.url : String(input);
  const method = init?.method ?? (isRequest ? input.method : "GET");
  return { url, method };
}

/**
 * The span name of a Supabase call, from its URL's path and its method:
 * - `/rest/v1/rpc/<fn>` → `rpc.<fn>`;
 * - `/rest/v1/<table>` → `db.<table>.<method>` (`get`, `head`, `post`, `patch`, `delete`);
 * - `/auth/v1/<op>` → `auth.<op>`, segments joined by `.`, ids replaced (`auth.admin.users.:id`);
 * - `/storage/v1/object/[public|sign|…/]<bucket>/…` → `storage.<bucket>`, and
 *   `/storage/v1/bucket…` → `storage.bucket`;
 * - anything else, or a URL that can't be read → `supabase.other`.
 *
 * A table, function or bucket name that isn't a plain identifier is `:value`. The query string, the
 * object path in a bucket, headers and body never reach the name.
 */
export function supabaseSpanName(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): string {
  try {
    const call = callOf(input, init);
    const match = API_PATH.exec(new URL(call.url).pathname);
    if (!match) return OTHER_SUPABASE_SPAN;
    const [, api, rest = ""] = match;
    const segments = rest.split("/").filter(Boolean);
    if (api === "rest") {
      const method = call.method.toLowerCase();
      return restSpanName(segments, METHOD.test(method) ? method : "other");
    }
    if (api === "auth") return authSpanName(rest);
    return storageSpanName(segments);
  } catch {
    return OTHER_SUPABASE_SPAN;
  }
}

/** The global `fetch`, looked up at call time (as supabase-js does by default), so a stub in a test still applies. */
const globalFetch: typeof fetch = (...args) => fetch(...args);

/**
 * A `fetch` that times each call to `inner` as a span named by {@link supabaseSpanName}, with
 * `status` when the answer is 400 or more and `error: true` when `inner` throws (rethrown
 * unchanged). Outside a request it calls `inner` and nothing else.
 */
export function createTracedFetch(inner: typeof fetch = globalFetch): typeof fetch {
  return async (...args: Parameters<typeof fetch>) => {
    const context = currentRequest();
    if (!context) return inner(...args);

    const name = supabaseSpanName(args[0], args[1]);
    const startedAt = performance.now();
    let response: Response;
    try {
      response = await inner(...args);
    } catch (error) {
      recordSpan(name, performance.now() - startedAt, { error: true }, context);
      throw error;
    }
    let status: number | undefined;
    try {
      status = response.status >= 400 ? response.status : undefined;
    } catch {
      // A stand-in response without a status: nothing to add.
    }
    recordSpan(name, performance.now() - startedAt, status === undefined ? {} : { status }, context);
    return response;
  };
}

/** The traced global `fetch`, for every Supabase client. */
export const tracedFetch: typeof fetch = createTracedFetch();
