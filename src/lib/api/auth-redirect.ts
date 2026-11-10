import { safeNextPath } from "@/lib/http/safe-next";

/** Pages that handle their own 401 (a wrong password, an invite or authorization that needs a sign-in). */
const OWN_401_PATHS = ["/login", "/join", "/oauth/consent", "/change-password"];

type RedirectLocation = Pick<Location, "pathname" | "search" | "replace">;

const alreadySent = new WeakSet<object>();

function handlesOwn401(pathname: string) {
  return OWN_401_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

/** `/login?next=<where the person was>`, with `next` cleaned by the same rule as the login page. */
export function loginUrlFor({ pathname, search }: Pick<Location, "pathname" | "search">) {
  return `/login?next=${encodeURIComponent(safeNextPath(`${pathname}${search}`))}`;
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
