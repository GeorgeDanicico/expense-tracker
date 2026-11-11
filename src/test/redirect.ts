/**
 * `next/navigation` for tests of server pages and layouts: `redirect` throws, like Next's, so nothing
 * after it runs. Use with `vi.mock("next/navigation", () => import("@/test/redirect"))`.
 */
export function redirect(url: string): never {
  throw Object.assign(new Error("NEXT_REDIRECT"), { url });
}

/** Runs a server page or layout: where it redirected, or what it rendered. Any other error is thrown. */
export async function renderOrRedirect<T>(render: () => T | Promise<T>): Promise<{ redirectedTo: string | null; rendered: T | null }> {
  try {
    return { redirectedTo: null, rendered: await render() };
  } catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") return { redirectedTo: (error as Error & { url: string }).url, rendered: null };
    throw error;
  }
}
