"use client";

import { useReportWebVitals } from "next/web-vitals";

import { reportWebVital } from "@/lib/client-log";

/**
 * Sends each page view's Web Vitals (LCP, INP, CLS, TTFB, FCP) to the server's logs (logging plan,
 * L7). Rendered once, in the root layout. `reportWebVital` is a module-level function, so its
 * reference never changes: a new one would make Next report the metrics again.
 */
export function WebVitals() {
  useReportWebVitals(reportWebVital);
  return null;
}
