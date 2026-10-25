import webpush, { WebPushError } from "web-push";

/** What a push shows: the service worker passes these to `showNotification` (see `public/sw.js`). */
export type PushPayload = {
  title: string;
  body: string;
  /** Where clicking the notification goes: a path in the app. */
  url: string;
  /** Replaces an earlier notification with the same tag on the device instead of stacking. */
  tag: string;
};

/** One browser's subscription, as stored in `push_subscriptions`. */
export type PushTarget = {
  endpoint: string;
  /** The subscription's public key (base64url). */
  p256dh: string;
  /** The subscription's auth secret (base64url). */
  auth: string;
};

/**
 * How one send went:
 * - `sent`: the push service accepted it.
 * - `gone`: 404 or 410, the subscription no longer exists; delete it.
 * - `retry`: 429, a 5xx or no answer at all (a network error or a timeout); try again later.
 * - `rejected`: any other answer (a bad request, a key the push service refuses) or a subscription
 *   `web-push` can't encrypt for; retrying won't help.
 */
export type PushResult =
  | { outcome: "sent" }
  | { outcome: "gone"; status: number }
  | { outcome: "retry"; status: number | null; error: string }
  | { outcome: "rejected"; status: number | null; error: string };

/** Sends one notification to one browser. Never throws: every failure is a {@link PushResult}. */
export interface PushSender {
  send(target: PushTarget, payload: PushPayload): Promise<PushResult>;
}

/** The VAPID keys and contact the worker signs pushes with (`npx web-push generate-vapid-keys`). */
export type VapidConfig = {
  publicKey: string;
  privateKey: string;
  /** A `mailto:` or `https:` URL the push services can contact. */
  subject: string;
};

/** How long a push service keeps an undelivered notification: 24 hours. */
export const PUSH_TTL_SECONDS = 24 * 60 * 60;
/** How long the worker waits for a push service before treating the send as a network error. */
export const PUSH_TIMEOUT_MS = 10_000;

/** The env variables of {@link VapidConfig}. */
export const VAPID_ENV = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;

/**
 * The VAPID config from `env`, or the names of the variables that are missing or empty. Never
 * returns or logs a key's value in the error case.
 */
export function readVapidConfig(
  env: Readonly<Record<string, string | undefined>>,
): { ok: true; config: VapidConfig } | { ok: false; missing: string[] } {
  const values = VAPID_ENV.map((name) => [name, env[name]?.trim() ?? ""] as const);
  const missing = values.filter(([, value]) => !value).map(([name]) => name);
  if (missing.length > 0) return { ok: false, missing };
  const [publicKey, privateKey, subject] = values.map(([, value]) => value);
  return { ok: true, config: { publicKey, privateKey, subject } };
}

/** The outcome for a push service's HTTP status (anything but 2xx). */
export function classifyPushStatus(status: number, error: string): Exclude<PushResult, { outcome: "sent" }> {
  if (status === 404 || status === 410) return { outcome: "gone", status };
  if (status === 429 || status >= 500) return { outcome: "retry", status, error };
  return { outcome: "rejected", status, error };
}

/** The push service's answer, without the endpoint (a per-device URL) or headers. */
function describe(error: unknown) {
  if (error instanceof WebPushError) return `Push service answered ${error.statusCode}${error.body ? `: ${error.body.slice(0, 200)}` : ""}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Whether a send failed before any answer: a Node system error (ECONNRESET, ENOTFOUND, ETIMEDOUT…)
 * or `web-push`'s own socket timeout. Anything else it throws is a bad subscription or option.
 */
function isNetworkError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return typeof (error as NodeJS.ErrnoException).code === "string" || error.message === "Socket timeout";
}

/**
 * `PushSender` with the `web-push` package: payload encrypted for the subscription, signed with the
 * VAPID keys, TTL 24 hours, urgency high. `setVapidDetails` validates the keys, so a bad key throws
 * here, at start-up, rather than on every send.
 */
export function createWebPushSender(vapid: VapidConfig, send: typeof webpush.sendNotification = webpush.sendNotification): PushSender {
  // Throws for a malformed key or subject; the options below pass them per send.
  webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
  const options = {
    vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
    TTL: PUSH_TTL_SECONDS,
    urgency: "high" as const,
    timeout: PUSH_TIMEOUT_MS,
  };

  return {
    async send(target, payload) {
      const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url, tag: payload.tag });
      try {
        await send({ endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } }, body, options);
        return { outcome: "sent" };
      } catch (error) {
        if (error instanceof WebPushError && error.statusCode > 0) return classifyPushStatus(error.statusCode, describe(error));
        if (isNetworkError(error)) return { outcome: "retry", status: null, error: describe(error) };
        return { outcome: "rejected", status: null, error: describe(error) };
      }
    },
  };
}
