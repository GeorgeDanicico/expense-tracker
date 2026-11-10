import { CalendarSkeleton } from "@/components/ui/skeletons";

/** Shown at once when you open the calendar, while the page loads. */
export default function Loading() {
  return <CalendarSkeleton />;
}
