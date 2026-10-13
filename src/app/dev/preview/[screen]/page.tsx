import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ScreenPreview } from "./screen-preview";
import { isPreviewScreen } from "./screens";

export const metadata: Metadata = { title: "Screen preview" };

/** Development-only: renders an app screen inside the shell with fixture data. */
export default async function ScreenPreviewPage({ params }: PageProps<"/dev/preview/[screen]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;
  if (!isPreviewScreen(screen)) notFound();
  return <ScreenPreview screen={screen} />;
}
