import { NextResponse, type NextRequest } from "next/server";

import { siteOrigin } from "@/lib/http/origin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const origin = siteOrigin(request);
  const callbackUrl = new URL("/auth/confirm", origin);
  callbackUrl.searchParams.set("next", "/dashboard");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: callbackUrl.toString() },
  });

  if (error || !data.url) {
    return NextResponse.redirect(new URL("/login?message=oauth-failed", origin));
  }
  return NextResponse.redirect(data.url);
}
