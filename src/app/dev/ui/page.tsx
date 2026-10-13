import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { UiGallery } from "./ui-gallery";

export const metadata: Metadata = { title: "UI gallery" };

/** Development-only style gallery for the UI primitives. */
export default function UiGalleryPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <UiGallery />;
}
