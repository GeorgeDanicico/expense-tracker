import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { mockupById } from "../mockups";
import { MockupScreen } from "../screens";

export async function generateMetadata({ params }: PageProps<"/dev/preview/mockups/[mockup]">): Promise<Metadata> {
  const { mockup } = await params;
  return { title: `Mockup: ${mockupById(mockup)?.title ?? "not found"}` };
}

/** Development-only: one of U3's mockups, with fixtures and no API calls. */
export default async function MockupPage({ params }: PageProps<"/dev/preview/mockups/[mockup]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { mockup } = await params;
  if (!mockupById(mockup)) notFound();
  return <MockupScreen id={mockup} />;
}
