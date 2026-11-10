import { PanelSkeleton } from "@/components/ui/skeletons";

/** Shown at once when you open More, while the page loads. */
export default function Loading() {
  return <PanelSkeleton title="More" label="Loading…" rows={4} />;
}
