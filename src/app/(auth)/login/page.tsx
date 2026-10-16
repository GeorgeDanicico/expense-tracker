import { LoginView } from "@/components/auth/login-view";
import { safeNextPath } from "@/lib/http/origin";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  return <LoginView next={safeNextPath(typeof next === "string" ? next : null)} />;
}
