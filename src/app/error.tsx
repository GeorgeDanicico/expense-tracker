"use client";

import { useEffect } from "react";

import { ErrorPage } from "@/components/ui/error-page";
import { reportClientError } from "@/lib/client-log";

/** The boundary for the pages outside `(app)` (sign-in, join, consent). Reports each error once, like `(app)/error.tsx`. */
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportClientError(error, "boundary");
  }, [error]);

  return <ErrorPage onRetry={retry} />;
}
