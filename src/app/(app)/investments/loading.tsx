import { PanelSkeleton } from "@/components/ui/skeletons";

/** Shown at once when you open Investments, while the page loads. */
export default function Loading() {
  return <PanelSkeleton title="Investments" label="Loading your investments…" />;
}
