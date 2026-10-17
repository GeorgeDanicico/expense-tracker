import { NextResponse, type NextRequest } from "next/server";

import { getAuth, type EmailLink, type EmailLinkType } from "@/lib/auth";
import { safeNextPath, siteOrigin } from "@/lib/http/origin";

function emailLink(searchParams: URLSearchParams): EmailLink | null {
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailLinkType | null;
  if (code) return { code };
  if (tokenHash && type) return { tokenHash, type };
  return null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const link = emailLink(searchParams);
  const next = safeNextPath(searchParams.get("next"));

  const confirmed = link ? (await getAuth().completeEmailLink(link)).ok : false;

  // Not request.nextUrl.origin: behind the container's HOSTNAME=0.0.0.0 that would be http://0.0.0.0:3000.
  const origin = siteOrigin(request);
  const target = confirmed ? new URL(next, origin) : new URL("/login?message=confirmation-failed", origin);
  return NextResponse.redirect(target);
}
