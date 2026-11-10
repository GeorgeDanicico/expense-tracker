import { RemindersSkeleton } from "@/components/ui/skeletons";

/** Shown at once when you open Reminders, while the page loads; the page's own loading state is the same skeleton. */
export default function Loading() {
  return <RemindersSkeleton />;
}
