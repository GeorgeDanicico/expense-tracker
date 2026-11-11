/**
 * The request header the proxy puts the page's path and query on. A layout isn't given the URL, and
 * the `(app)` layout needs it to send a signed-out visitor to `/login?next=<that page>` (PF5). The
 * proxy sets it on every request it runs on, replacing any the client sent; the layout still cleans
 * it with `safeNextPath`.
 */
export const PAGE_PATH_HEADER = "x-page-path";

/** The path and query of a request's URL, without Next's `_rsc` parameter (it only busts caches). */
export function pagePathOf({ pathname, search }: { pathname: string; search: string }): string {
  const query = new URLSearchParams(search);
  query.delete("_rsc");
  const rest = query.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
