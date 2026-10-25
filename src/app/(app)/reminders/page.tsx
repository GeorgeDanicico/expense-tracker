"use client";

import { RemindersScreen } from "@/components/reminders/reminders-screen";
import { useDocumentTitle } from "@/hooks/use-document-title";

// Not linked from the navigation yet; R9 adds the nav item and its badge.
export default function RemindersPage() {
  useDocumentTitle("Reminders");
  return <RemindersScreen />;
}
