import { NextResponse, type NextRequest } from "next/server";

import { getAuth, type EmailLink, type EmailLinkType } from "@/lib/auth";

function safeNextPath(value: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

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

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = confirmed ? next : "/login";
  redirectUrl.search = confirmed ? "" : "message=confirmation-failed";
  return NextResponse.redirect(redirectUrl);
}
