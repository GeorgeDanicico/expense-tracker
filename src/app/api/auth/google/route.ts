import { NextResponse, type NextRequest } from "next/server";

import { getAuth } from "@/lib/auth";
import { safeNextPath, siteOrigin } from "@/lib/http/origin";

export async function GET(request: NextRequest) {
  const origin = siteOrigin(request);
  const callbackUrl = new URL("/auth/confirm", origin);
  callbackUrl.searchParams.set("next", safeNextPath(request.nextUrl.searchParams.get("next")));

  const signIn = await getAuth().oauthSignInUrl("google", callbackUrl.toString());

  if (!signIn.ok) {
    return NextResponse.redirect(new URL("/login?message=oauth-failed", origin));
  }
  return NextResponse.redirect(signIn.url);
}
