import { notFound } from "next/navigation";

import { MockupShell } from "./mockup-shell";

/**
 * Development-only: U3's mockups. The shell stays mounted between mockups, so the stand-in bottom
 * bar and sidebar behave like the app's.
 */
export default function MockupsLayout({ children }: LayoutProps<"/dev/preview/mockups">) {
  if (process.env.NODE_ENV === "production") notFound();
  return <MockupShell>{children}</MockupShell>;
}
