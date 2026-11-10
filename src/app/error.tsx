"use client";

import { SectionError } from "@/components/ui/section-error";

/** The boundary for the pages outside `(app)` (sign-in, join, consent): the same component, with no link to Home. */
export default function RootError(props: { error: unknown; retry: () => void }) {
  return <SectionError {...props} homeHref={null} />;
}
