"use client";

import { useHomeBlocks } from "@/components/dashboard/home-layout";
import { HomeSkeleton } from "@/components/dashboard/home-skeleton";

/** Shown at once when you open Home, in the layout of the blocks this person has. */
export default function Loading() {
  const { spending, todos } = useHomeBlocks();
  return <HomeSkeleton spending={spending} todos={todos} />;
}
