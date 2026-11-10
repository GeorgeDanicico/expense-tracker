import { PanelSkeleton } from "@/components/ui/skeletons";

/** Shown at once when you open Net worth, while the page loads. */
export default function Loading() {
  return <PanelSkeleton title="Net worth" label="Loading your net worth…" />;
}
