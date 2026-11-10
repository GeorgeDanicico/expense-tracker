import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isQuickAddKind } from "@/components/quick-add/kinds";

import { ScreenPreview } from "./screen-preview";
import { isPreviewScreen } from "./screens";

export const metadata: Metadata = { title: "Screen preview" };

/** Development-only: renders an app screen inside the shell with fixture data. */
export default async function ScreenPreviewPage({ params, searchParams }: PageProps<"/dev/preview/[screen]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;
  if (!isPreviewScreen(screen)) notFound();
  // `?quickAdd=expense` (or todo, reminder, event; empty for the last kind used) opens the quick-add sheet.
  const { quickAdd, fixture } = await searchParams;
  const kind = typeof quickAdd === "string" && isQuickAddKind(quickAdd) ? quickAdd : undefined;
  // `?fixture=hang` or `?fixture=fail` preview the slow and error states (see `ScreenPreview`).
  return <ScreenPreview screen={screen} quickAdd={typeof quickAdd === "string" ? { kind } : null} fixture={fixture === "hang" || fixture === "fail" ? fixture : "ok"} />;
}
