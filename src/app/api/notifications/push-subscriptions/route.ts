import { json, parseBody, withUser } from "@/lib/http/route";
import { getRepositories } from "@/lib/repositories";
import { pushEndpointSchema, pushSubscriptionSchema, storedUserAgent } from "@/lib/validation/notifications";

/**
 * Registers this browser's push subscription for the caller (moving it from another account that
 * had it) and answers the settings with the new device count (201). Calling it again is harmless.
 */
export const POST = withUser(async (request) => {
  const { endpoint, keys } = await parseBody(request, pushSubscriptionSchema, "Invalid push subscription.");
  const { notificationSettings } = getRepositories();
  await notificationSettings.registerPushSubscription({
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    userAgent: storedUserAgent(request.headers.get("user-agent")),
  });
  return json(await notificationSettings.get(), 201);
}, { failure: "Unable to enable notifications on this device. Please try again." });

/**
 * Deletes the caller's subscription with this endpoint and answers the settings. An endpoint the
 * caller doesn't have changes nothing and still answers 200, so turning off twice (or signing out
 * after the worker removed a dead subscription) never fails.
 */
export const DELETE = withUser(async (request) => {
  const { endpoint } = await parseBody(request, pushEndpointSchema, "Invalid push subscription.");
  const { notificationSettings } = getRepositories();
  await notificationSettings.deletePushSubscription(endpoint);
  return json(await notificationSettings.get());
}, { failure: "Unable to turn off notifications on this device. Please try again." });
