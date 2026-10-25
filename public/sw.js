const CACHE_NAME = "simple-ledger-shell-v5";
const OFFLINE_ASSETS = ["/offline", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return cache.match("/offline");
    }),
  );
});

// --- Web Push (reminders plan R7) ---------------------------------------------------------------

const DEFAULT_NOTIFICATION = { title: "iFam", body: "", url: "/", tag: "" };

/** The pushed `{ title, body, url, tag }`, falling back to defaults for anything missing. */
function readPush(event) {
  try {
    const data = event.data ? event.data.json() : {};
    return {
      title: typeof data.title === "string" && data.title ? data.title : DEFAULT_NOTIFICATION.title,
      body: typeof data.body === "string" ? data.body : DEFAULT_NOTIFICATION.body,
      url: typeof data.url === "string" && data.url.startsWith("/") ? data.url : DEFAULT_NOTIFICATION.url,
      tag: typeof data.tag === "string" ? data.tag : DEFAULT_NOTIFICATION.tag,
    };
  } catch {
    return DEFAULT_NOTIFICATION;
  }
}

// Always shows the system notification, even with the app open: Safari drops subscriptions whose
// pushes show nothing. Then tells open windows, so the reminders badge refreshes.
self.addEventListener("push", (event) => {
  const { title, body, url, tag } = readPush(event);
  event.waitUntil(
    self.registration
      .showNotification(title, { body, tag: tag || undefined, data: { url }, icon: "/icon-192.png", badge: "/icon-192.png" })
      .then(() => self.clients.matchAll({ type: "window", includeUncontrolled: true }))
      .then((windows) => windows.forEach((client) => client.postMessage({ type: "notification" }))),
  );
});

// Focuses an open window of the app and takes it to the notification's page, or opens one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = event.notification.data && typeof event.notification.data.url === "string" ? event.notification.data.url : "/";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) {
        const focused = await open.focus();
        return "navigate" in focused ? focused.navigate(target) : focused;
      }
      return self.clients.openWindow(target);
    }),
  );
});

/** The VAPID public key (base64url) as the bytes `pushManager.subscribe` wants. */
function keyBytes(base64url) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

// The browser replaced or expired the subscription: subscribe again with the server's key and
// register the new one, and drop the old one. Works only while the session cookie is valid; if it
// fails, "Enable on this device" in Settings → Notifications sets it up again.
self.addEventListener("pushsubscriptionchange", (event) => {
  const oldEndpoint = event.oldSubscription ? event.oldSubscription.endpoint : null;
  event.waitUntil(
    (async () => {
      let subscription = event.newSubscription;
      if (!subscription) {
        const response = await fetch("/api/notifications/push-key", { credentials: "same-origin" });
        if (!response.ok) return;
        const { publicKey } = await response.json();
        subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        });
      }
      await fetch("/api/notifications/push-subscriptions", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      if (oldEndpoint && oldEndpoint !== subscription.endpoint) {
        await fetch("/api/notifications/push-subscriptions", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: oldEndpoint }),
        });
      }
    })().catch(() => undefined),
  );
});
