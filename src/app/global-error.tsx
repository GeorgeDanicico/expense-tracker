"use client";

import { RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, type CSSProperties } from "react";

import { reportClientError } from "@/lib/client-log";

/*
 * The colours and sizes of the theme (src/components/ui/theme/tokens.ts), written out: this page
 * replaces the root layout, so neither the stylesheet nor Chakra's provider is there.
 */
const styles = {
  body: {
    margin: 0,
    minHeight: "100dvh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "1rem",
    background: "#F4F3EE",
    color: "#292824",
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    WebkitFontSmoothing: "antialiased",
  },
  card: {
    width: "100%",
    maxWidth: "400px",
    boxSizing: "border-box",
    padding: "2rem 1.5rem",
    textAlign: "center",
    background: "#FFFFFF",
    border: "1px solid #E6E4DC",
    borderRadius: "0.625rem",
  },
  icon: { color: "#8C8981" },
  title: { margin: "0.75rem 0 0.25rem", fontSize: "1.125rem", fontWeight: 600 },
  description: { margin: "0 0 1.25rem", fontSize: "0.875rem", color: "#625F58" },
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.5rem 1rem",
    font: "inherit",
    fontSize: "0.875rem",
    fontWeight: 500,
    color: "#FFFFFF",
    background: "#292824",
    border: 0,
    borderRadius: "0.375rem",
    cursor: "pointer",
  },
} satisfies Record<string, CSSProperties>;

/**
 * The boundary for a failure in the root layout itself. It renders its own `<html>` and `<body>`,
 * and reports each error once as `global_boundary`, with the `digest` that finds the server's own line.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    reportClientError(error, "global_boundary");
  }, [error]);

  return (
    <html lang="en">
      <body style={styles.body}>
        <title>Something went wrong</title>
        <main style={styles.card}>
          <TriangleAlert size={32} strokeWidth={1.75} style={styles.icon} aria-hidden="true" />
          <h1 style={styles.title}>We couldn’t load this page</h1>
          <p style={styles.description}>Your data is safe. Check your connection and try again.</p>
          <button type="button" onClick={retry} style={styles.button}>
            <RefreshCw size={16} strokeWidth={1.75} aria-hidden="true" /> Try again
          </button>
        </main>
      </body>
    </html>
  );
}
