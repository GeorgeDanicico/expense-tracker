"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { RemindersScreen } from "@/components/reminders/reminders-screen";
import { RemindersSkeleton } from "@/components/ui/skeletons";
import { useDocumentTitle } from "@/hooks/use-document-title";

/** The screen with `?focus=<id>` from the URL: a reminder notification opens the page on its reminder. */
function FocusedRemindersScreen() {
  return <RemindersScreen focusId={useSearchParams().get("focus")} />;
}

// Not linked from the navigation yet; R9 adds the nav item and its badge.
export default function RemindersPage() {
  useDocumentTitle("Reminders");
  // `useSearchParams` needs a boundary above it.
  return (
    <Suspense fallback={<RemindersSkeleton />}>
      <FocusedRemindersScreen />
    </Suspense>
  );
}
