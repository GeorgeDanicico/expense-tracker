"use client";

import { useEffect } from "react";

import { ErrorPage } from "@/components/ui/error-page";
import { reportClientError } from "@/lib/client-log";

/**
 * The error boundary of a section (`error.tsx` in each folder under `(app)`), and of the pages outside
 * it. A section's own boundary keeps the app shell and its navigation on screen, so an error in
 * Investments leaves the bottom bar and the sidebar working. It reports each error once, with the
 * `digest` that finds the server's own line (L7), and offers Try again (`retry`) and a way home.
 */
export function SectionError({ error, retry, homeHref = "/dashboard" }: { error: unknown; retry: () => void; homeHref?: string | null }) {
  useEffect(() => {
    reportClientError(error, "boundary");
  }, [error]);

  return <ErrorPage onRetry={retry} homeHref={homeHref} />;
}
