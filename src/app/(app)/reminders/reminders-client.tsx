"use client";

import { useSearchParams } from "next/navigation";

import { RemindersScreen } from "@/components/reminders/reminders-screen";
import { RemindersSkeleton } from "@/components/ui/skeletons";
import { StreamedSection } from "@/components/ui/streamed-section";
import { useDocumentTitle } from "@/hooks/use-document-title";

/** The screen with `?focus=<id>` from the URL: a reminder notification opens the page on its reminder. */
function FocusedRemindersScreen() {
  return <RemindersScreen focusId={useSearchParams().get("focus")} />;
}

/** The Reminders page's body. The list streams in as the server's data arrives (`useSearchParams` needs a boundary too). */
export function RemindersClient() {
  useDocumentTitle("Reminders");
  return (
    <StreamedSection fallback={<RemindersSkeleton />}>
      <FocusedRemindersScreen />
    </StreamedSection>
  );
}
