import { PanelSkeleton } from "@/components/ui/skeletons";

/** Shown at once when you open Settings, while the page loads. */
export default function Loading() {
  return <PanelSkeleton title="Settings" label="Loading your settings…" rows={4} />;
}
