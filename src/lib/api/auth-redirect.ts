import { safeNextPath } from "@/lib/http/safe-next";

/** Pages that handle their own 401 (a wrong password, an invite or authorization that needs a sign-in). */
const OWN_401_PATHS = ["/login", "/join", "/oauth/consent", "/change-password"];

type RedirectLocation = Pick<Location, "pathname" | "search" | "replace">;

const alreadySent = new WeakSet<object>();

function handlesOwn401(pathname: string) {
  return OWN_401_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** `/login?next=<path>`, with `next` cleaned by the same rule as the login page. The `(app)` layout redirects here too (PF5). */
export function loginUrl(path: string | null | undefined) {
  return `/login?next=${encodeURIComponent(safeNextPath(path))}`;
}

/** `/login?next=<where the person was>`. */
export function loginUrlFor({ pathname, search }: Pick<Location, "pathname" | "search">) {
  return loginUrl(`${pathname}${search}`);
}

/**
 * Goes to `path` with a full page load: every move across a change of session (signing in or out, a
 * deleted account, a new password) goes through here. Next's router keeps prefetched pages in memory,
 * and since PF5 the `(app)` layout's answer depends on the session: a page prefetched while signed out
 * is a redirect to sign in, and one prefetched as someone else carries their account. Following a
 * cached redirect after signing in bounced between `/login` and `/dashboard` in the lab. A full load
 * starts with an empty router and SWR cache.
 */
export function loadAfterSessionChange(path: string, location: Pick<Location, "replace"> = window.location) {
  location.replace(path);
}

/**
 * Sends the browser to sign in when any request got a 401: the session ended while the app was open.
 * Does nothing on the pages that handle their own 401, and sends the browser once however many
 * requests fail together. Returns whether it redirected.
 */
export function redirectToLoginIfUnauthorized(
  status: number,
  location: RedirectLocation | undefined = typeof window === "undefined" ? undefined : window.location,
): boolean {
  if (status !== 401 || !location || handlesOwn401(location.pathname) || alreadySent.has(location)) return false;
  alreadySent.add(location);
  location.replace(loginUrlFor(location));
  return true;
}
