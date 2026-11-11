"use client";

import { CacheProvider } from "@emotion/react";
import { Suspense, type ReactNode } from "react";

/**
 * A section of a page that streams in after the rest when its data comes from the server (PF6):
 * `<Suspense>` with `fallback` (the section's loading card) until the data arrives.
 *
 * On the server its contents also get an Emotion style cache of their own. Chakra's styles are
 * Emotion's, written as `<style>` tags next to the elements that use them, and Emotion writes each
 * rule once per cache. Under one shared cache, a rule first written for the loading card isn't written
 * again for the content that replaces it; when the streamed content swaps the card out, the card's
 * `<style>` tags go with it, and the content is unstyled until the page hydrates. In the lab that was
 * a layout shift of 0.34 on the emulated phone, five seconds after the data was on screen. With a
 * cache of their own (Emotion makes one on the server when the context holds `null`), the contents
 * carry every rule they use. In the browser Emotion keeps one cache and puts every rule in `<head>`,
 * so nothing changes there.
 */
export function StreamedSection({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  return <Suspense fallback={fallback}>{typeof window === "undefined" ? <CacheProvider value={null as never}>{children}</CacheProvider> : children}</Suspense>;
}
