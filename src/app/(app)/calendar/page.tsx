"use client";

import { Suspense } from "react";

import { CalendarScreen } from "@/components/family-calendar/calendar-screen";
import { DataLoading } from "@/components/ui/data-state";
import { useDocumentTitle } from "@/hooks/use-document-title";

// Not linked from the navigation yet; C6 adds the nav item.
export default function CalendarPage() {
  useDocumentTitle("Calendar");
  // The view and date live in the URL, and `useSearchParams` needs a boundary above it.
  return (
    <Suspense fallback={<DataLoading label="Loading the calendar…" />}>
      <CalendarScreen />
    </Suspense>
  );
}
