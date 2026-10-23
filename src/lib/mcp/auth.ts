import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { type AuthSession, getAuth, getAuthAdmin } from "@/lib/auth";
import { MCP_REFUSALS } from "@/lib/mcp/refusals";
import type { McpTokenCheck } from "@/lib/mcp/token-repository";
import { hashMcpToken, hasMcpTokenPrefix, mcpTokenDisplayPrefix, parseMcpToken } from "@/lib/mcp/tokens";
import { getRepositories } from "@/lib/repositories";

type McpCredentials = { email: string; password: string };

/** What a request's `Authorization` header asks for (docs/mcp-access-plan.md, M6). */
export type McpAuthorization =
  | { kind: "personal"; token: string }
  | { kind: "app"; token: string }
  | { kind: "basic"; credentials: McpCredentials | null }
  | { kind: "none" };

export type McpAuthResult =
  | { status: "ok"; session: AuthSession }
  | { status: "unauthorized" }
  | { status: "throttled" }
  | { status: "forbidden"; message: string }
  /** The token is valid but no session could be opened (or the secret key is missing): retry later. */
  | { status: "unavailable" };

const MAX_SESSIONS = 20;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;

// Same limits as the login route's authSchema.
const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

/**
 * Open sessions, shared by Basic (`cred:<hash of email and password>`) and personal tokens
 * (`token:<token hash>`, so a revoked or regenerated token's entry can be found without its id).
 * Oldest first; at most `MAX_SESSIONS`.
 */
const sessions = new Map<string, Promise<AuthSession | null>>();
const failures = new Map<string, number[]>();

export function parseBasicCredentials(request: Request): McpCredentials | null {
  const match = request.headers.get("authorization")?.match(/^Basic\s+(\S+)$/i);
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  const parsed = credentialsSchema.safeParse({
    email: decoded.slice(0, separator),
    password: decoded.slice(separator + 1),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Routes on the header: `Bearer sl_mcp_…` is a personal token, any other `Bearer` an OAuth app's
 * access token, `Basic` a password (until M10). A `Bearer` with no token is an app token that fails.
 */
export function readMcpAuthorization(request: Request): McpAuthorization {
  const header = request.headers.get("authorization");
  const bearer = header?.match(/^Bearer(?:\s+(.*))?$/i);
  if (bearer) {
    const token = bearer[1]?.trim() ?? "";
    return hasMcpTokenPrefix(token) ? { kind: "personal", token } : { kind: "app", token };
  }
  if (header && /^Basic(?:\s|$)/i.test(header)) return { kind: "basic", credentials: parseBasicCredentials(request) };
  return { kind: "none" };
}

function credentialKey({ email, password }: McpCredentials) {
  return createHash("sha256").update(`${email}\0${password}`).digest("hex");
}

function failureKeys(key: string, clientIp: string | null) {
  return clientIp ? [key, `ip:${clientIp}`] : [key];
}

function isThrottled(keys: string[]) {
  const cutoff = Date.now() - FAILURE_WINDOW_MS;
  return keys.some((key) => {
    const recent = (failures.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length) failures.set(key, recent);
    else failures.delete(key);
    return recent.length >= MAX_FAILURES;
  });
}

function recordFailure(keys: string[]) {
  const now = Date.now();
  for (const key of keys) failures.set(key, [...(failures.get(key) ?? []), now]);
}

function endSession(pending: Promise<AuthSession | null>) {
  return pending.then((session) => session?.end());
}

/** Caches a new session under `key`, ending the oldest when the cache is full. A failed open isn't cached. */
function openSession(key: string, open: () => Promise<AuthSession | null>) {
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.entries().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest[0]);
    void endSession(oldest[1]);
  }
  const pending = open();
  sessions.set(key, pending);
  void pending.then((session) => {
    if (!session && sessions.get(key) === pending) sessions.delete(key);
  });
  return pending;
}

/** The cached session for `key`, or a new one; a cached session that can't refresh is replaced once. */
async function cachedSession(key: string, open: () => Promise<AuthSession | null>) {
  const cached = sessions.get(key);
  let pending = cached ?? openSession(key, open);
  const session = cached && (await cached);
  if (session && !(await session.isActive())) {
    // Refresh failed: drop the stale entry and open one more (shared with concurrent callers).
    if (sessions.get(key) === pending) sessions.delete(key);
    pending = sessions.get(key) ?? openSession(key, open);
  }
  return pending;
}

/** Drops and signs out the cached session under `key`, if any. */
async function dropSession(key: string) {
  const cached = sessions.get(key);
  if (!cached) return;
  sessions.delete(key);
  await endSession(cached);
}

export async function getMcpSession(credentials: McpCredentials, clientIp: string | null): Promise<McpAuthResult> {
  const key = `cred:${credentialKey(credentials)}`;
  const keys = failureKeys(key, clientIp);
  if (isThrottled(keys)) return { status: "throttled" };

  const session = await cachedSession(key, () => getAuth().startSession(credentials.email, credentials.password));
  if (!session) {
    recordFailure(keys);
    return { status: "unauthorized" };
  }
  return { status: "ok", session };
}

/**
 * A personal token: the throttle, then `check` with the secret key, then the cached session for the
 * token or a new one from `startSessionForUser`. Unknown, revoked, expired and malformed tokens count
 * toward the throttle; access refusals don't (they're settings to fix, not guesses). Any status but
 * `ok` drops and ends the token's cached session.
 */
export async function getMcpTokenSession(value: string, clientIp: string | null): Promise<McpAuthResult> {
  const keys = failureKeys(`prefix:${mcpTokenDisplayPrefix(value)}`, clientIp);
  if (isThrottled(keys)) return { status: "throttled" };

  const token = parseMcpToken(value);
  if (!token) {
    recordFailure(keys);
    return { status: "unauthorized" };
  }

  const hash = hashMcpToken(token);
  const key = `token:${hash}`;
  let check: McpTokenCheck;
  try {
    check = await getRepositories().mcpTokens.check(hash);
  } catch {
    // The secret key is missing or the database failed: the token may well be valid.
    return { status: "unavailable" };
  }

  if (check.status !== "ok") {
    await dropSession(key);
    if (check.status === "unknown" || check.status === "revoked" || check.status === "expired") {
      recordFailure(keys);
      return { status: "unauthorized" };
    }
    return { status: "forbidden", message: MCP_REFUSALS[check.status] };
  }

  const { user } = check;
  // getAuthAdmin() throws when SUPABASE_SECRET_KEY is missing; that's a 503 too, not a bad token.
  const session = await cachedSession(key, async () => {
    try {
      return await getAuthAdmin().startSessionForUser(user);
    } catch {
      return null;
    }
  });
  return session ? { status: "ok", session } : { status: "unavailable" };
}

/**
 * An OAuth app's access token: verified (and its session checked live) with the provider on every
 * request, then the user's access checked as that user. No audience check: Supabase sets
 * `aud: "authenticated"` and ignores the `resource` parameter (P1 finding 1).
 */
export async function getMcpAppSession(token: string): Promise<McpAuthResult> {
  if (!token) return { status: "unauthorized" };
  const auth = getAuth();
  if (!(await auth.verifyAppToken(token))) return { status: "unauthorized" };

  const session = auth.sessionForAppToken(token);
  const access = await session.run(() => getRepositories().mcpTokens.access());
  if (access.status !== "ok") return { status: "forbidden", message: MCP_REFUSALS[access.status] };
  return { status: "ok", session };
}

/** Authenticates an `/api/mcp` request by whichever way in its header uses. */
export function authenticateMcpRequest(authorization: McpAuthorization, clientIp: string | null): Promise<McpAuthResult> {
  switch (authorization.kind) {
    case "personal":
      return getMcpTokenSession(authorization.token, clientIp);
    case "app":
      return getMcpAppSession(authorization.token);
    case "basic":
      return authorization.credentials
        ? getMcpSession(authorization.credentials, clientIp)
        : Promise.resolve({ status: "unauthorized" });
    case "none":
      return Promise.resolve({ status: "unauthorized" });
  }
}

export function resetMcpAuthForTests() {
  sessions.clear();
  failures.clear();
}
