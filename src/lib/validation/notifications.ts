import { z } from "zod";

const SWITCH_MESSAGE = "Say whether this kind of notification is on.";
const SUBSCRIPTION_MESSAGE = "This browser's push subscription isn't valid. Try enabling notifications again.";

// The limits of `push_subscriptions` (see the reminders migration).
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_USER_AGENT_LENGTH = 500;
const BASE64URL = /^[A-Za-z0-9_-]+=*$/;

/** The body of `PATCH /api/notifications/settings`: one or more of the three switches. */
export const notificationSettingsPatchSchema = z
  .strictObject({
    pushEnabled: z.boolean(SWITCH_MESSAGE).optional(),
    remindersEnabled: z.boolean(SWITCH_MESSAGE).optional(),
    todosEnabled: z.boolean(SWITCH_MESSAGE).optional(),
  }, "Send only pushEnabled, remindersEnabled or todosEnabled.")
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), "Change at least one switch.");

const endpoint = z
  .string(SUBSCRIPTION_MESSAGE)
  .max(MAX_ENDPOINT_LENGTH, SUBSCRIPTION_MESSAGE)
  .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", SUBSCRIPTION_MESSAGE);

/**
 * The body of `POST /api/notifications/push-subscriptions`: `PushSubscription.toJSON()` as the
 * browser gives it (`expirationTime` and anything else is ignored).
 */
export const pushSubscriptionSchema = z.object({
  endpoint,
  keys: z.object({
    p256dh: z.string(SUBSCRIPTION_MESSAGE).min(1, SUBSCRIPTION_MESSAGE).max(200, SUBSCRIPTION_MESSAGE).regex(BASE64URL, SUBSCRIPTION_MESSAGE),
    auth: z.string(SUBSCRIPTION_MESSAGE).min(1, SUBSCRIPTION_MESSAGE).max(100, SUBSCRIPTION_MESSAGE).regex(BASE64URL, SUBSCRIPTION_MESSAGE),
  }, SUBSCRIPTION_MESSAGE),
});

/** The body of `DELETE /api/notifications/push-subscriptions`. */
export const pushEndpointSchema = z.object({ endpoint });

/** The request's user agent as stored with a subscription: at most 500 characters. */
export function storedUserAgent(userAgent: string | null) {
  return (userAgent ?? "").slice(0, MAX_USER_AGENT_LENGTH);
}
