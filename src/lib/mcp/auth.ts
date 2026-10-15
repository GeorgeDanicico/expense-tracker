import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { type AuthSession, getAuth } from "@/lib/auth";

type McpCredentials = { email: string; password: string };
type McpAuthResult =
  | { status: "ok"; session: AuthSession }
  | { status: "unauthorized" }
  | { status: "throttled" };

const MAX_SESSIONS = 20;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;

// Same limits as the login route's authSchema.
const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
});

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

function credentialKey({ email, password }: McpCredentials) {
  return createHash("sha256").update(`${email}\0${password}`).digest("hex");
}

function failureKeys(key: string, clientIp: string | null) {
  return clientIp ? [`cred:${key}`, `ip:${clientIp}`] : [`cred:${key}`];
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

function startSignIn(key: string, credentials: McpCredentials) {
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
  const pending = getAuth().startSession(credentials.email, credentials.password);
  sessions.set(key, pending);
  void pending.then((session) => {
    if (!session && sessions.get(key) === pending) sessions.delete(key);
  });
  return pending;
}

export async function getMcpSession(
  credentials: McpCredentials,
  clientIp: string | null,
): Promise<McpAuthResult> {
  const key = credentialKey(credentials);
  const keys = failureKeys(key, clientIp);
  if (isThrottled(keys)) return { status: "throttled" };

  const cached = sessions.get(key);
  let pending = cached ?? startSignIn(key, credentials);
  const cachedSession = cached && (await cached);
  if (cachedSession && !(await cachedSession.isActive())) {
    // Refresh failed: drop the stale entry and sign in once more (shared with concurrent callers).
    if (sessions.get(key) === pending) sessions.delete(key);
    pending = sessions.get(key) ?? startSignIn(key, credentials);
  }

  const session = await pending;
  if (!session) {
    recordFailure(keys);
    return { status: "unauthorized" };
  }
  return { status: "ok", session };
}

export function resetMcpAuthForTests() {
  sessions.clear();
  failures.clear();
}
