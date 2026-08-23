import { redirect } from "next/navigation";

import { AppShell } from "@/components/layout/app-shell";
import { getAuthenticatedUser } from "@/lib/auth";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");

  return <AppShell email={user.email}>{children}</AppShell>;
}
