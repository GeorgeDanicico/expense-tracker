"use client";

import { useEffect } from "react";

import { ErrorPage } from "@/components/ui/error-page";
import { reportClientError } from "@/lib/client-log";

/** The boundary for the signed-in pages. It reports each error once, with the `digest` that finds the server's own line. */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportClientError(error, "boundary");
  }, [error]);

  return <ErrorPage onRetry={retry} />;
}
