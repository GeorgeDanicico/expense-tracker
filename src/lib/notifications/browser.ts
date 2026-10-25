/**
 * This browser's side of Web Push: what it supports, and subscribing or unsubscribing it. Client
 * only; every function reads `window` and `navigator` when called, never at import.
 */

/**
 * What "This device" can offer:
 * - `unsupported`: no service worker, Push API or Notification API.
 * - `ios-home-screen`: an iPhone or iPad in Safari; push works only in the app added to the home screen.
 * - `denied`: the user blocked notifications for this site.
 * - `ready`: notifications can be enabled (or already are).
 */
export type DeviceSupport = "unsupported" | "ios-home-screen" | "denied" | "ready";

/** The parts of the browser {@link deviceSupport} reads, so it can be tested without one. */
export type BrowserFacts = {
  userAgent: string;
  maxTouchPoints: number;
  /** Running as the installed (home-screen) app. */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: NotificationPermission | null;
};

/** iPhone, iPod or iPad, including iPadOS, which reports itself as a Mac with touch. */
export function isAppleMobile({ userAgent, maxTouchPoints }: Pick<BrowserFacts, "userAgent" | "maxTouchPoints">) {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export function deviceSupport(facts: BrowserFacts): DeviceSupport {
  // Safari on iOS only exposes the Push API inside the home-screen app, so check this first.
  if (isAppleMobile(facts) && !facts.standalone) return "ios-home-screen";
  if (!facts.hasServiceWorker || !facts.hasPushManager || !facts.hasNotification) return "unsupported";
  if (facts.permission === "denied") return "denied";
  return "ready";
}

/** The facts about the browser this code runs in. */
export function browserFacts(): BrowserFacts {
  const hasNotification = typeof Notification !== "undefined";
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone:
      window.matchMedia?.("(display-mode: standalone)").matches === true ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : null,
  };
}

/** A base64url VAPID public key as the bytes `pushManager.subscribe` wants. */
export function applicationServerKey(base64url: string) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** The app's service worker registration, registering it if it isn't yet (in development, say). */
async function registration() {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

/** This browser's current push subscription, or null (also when push isn't available). */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || typeof window === "undefined" || !("PushManager" in window)) {
    return null;
  }
  const existing = await navigator.serviceWorker.getRegistration("/");
  return existing ? existing.pushManager.getSubscription() : null;
}

/** Why enabling didn't give a subscription. */
export class PushPermissionError extends Error {
  constructor(readonly permission: NotificationPermission) {
    super(permission === "denied" ? "Notifications are blocked for this site." : "Notifications weren't allowed. Try again and choose Allow.");
    this.name = "PushPermissionError";
  }
}

/**
 * Asks for permission and subscribes this browser with `publicKey`. Call it straight from a click
 * handler, with the key already loaded: Safari only shows the permission prompt for a user gesture.
 * Returns the subscription as JSON, ready for `POST /api/notifications/push-subscriptions`.
 */
export async function subscribeThisDevice(publicKey: string): Promise<PushSubscriptionJSON> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushPermissionError(permission);
  const worker = await registration();
  const key = applicationServerKey(publicKey);
  let subscription = await worker.pushManager.getSubscription();
  // A subscription made with another key (the server's key changed) can't receive our pushes.
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  return subscription.toJSON();
}

function sameKey(existing: ArrayBuffer | null, key: Uint8Array) {
  if (!existing) return true;
  const bytes = new Uint8Array(existing);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

/**
 * Unsubscribes this browser and returns the endpoint it had (for `DELETE
 * /api/notifications/push-subscriptions`), or null when it had none.
 */
export async function unsubscribeThisDevice(): Promise<string | null> {
  const subscription = await currentSubscription();
  if (!subscription) return null;
  const { endpoint } = subscription;
  await subscription.unsubscribe();
  return endpoint;
}
