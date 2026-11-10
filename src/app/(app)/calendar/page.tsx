"use client";

import { Suspense } from "react";

import { CalendarScreen } from "@/components/family-calendar/calendar-screen";
import { CalendarSkeleton } from "@/components/ui/skeletons";
import { useDocumentTitle } from "@/hooks/use-document-title";

export default function CalendarPage() {
  useDocumentTitle("Calendar");
  // The view, date and member filter live in the URL, and `useSearchParams` needs a boundary above it.
  return (
    <Suspense fallback={<CalendarSkeleton />}>
      <CalendarScreen />
    </Suspense>
  );
}
