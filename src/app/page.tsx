import { redirect } from "next/navigation";

/**
 * `/` has nothing of its own: it sends everyone to Home, on the server and before any of the app's
 * JavaScript (PF5). Home's layout then decides the rest: no session → sign in, a password that must
 * be changed → `/change-password`. Reading the session here too would only cost one more call to
 * Supabase Auth.
 */
export default function RootPage() {
  redirect("/dashboard");
}
