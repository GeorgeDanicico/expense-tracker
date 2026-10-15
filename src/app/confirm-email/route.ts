import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAuth } from "@/lib/auth";

const confirmationSchema = z.object({
  email: z.email(),
  token: z.string().regex(/^\d{6}$/),
  type: z.literal("email"),
});

export async function GET(request: NextRequest) {
  const parsed = confirmationSchema.safeParse({
    email: request.nextUrl.searchParams.get("email"),
    token: request.nextUrl.searchParams.get("token"),
    type: request.nextUrl.searchParams.get("type"),
  });
  const redirectUrl = request.nextUrl.clone();

  if (!parsed.success) {
    redirectUrl.pathname = "/login";
    redirectUrl.search = "message=confirmation-failed";
    return NextResponse.redirect(redirectUrl);
  }

  const { ok } = await getAuth().completeEmailLink(parsed.data);

  redirectUrl.pathname = ok ? "/dashboard" : "/login";
  redirectUrl.search = ok ? "" : "message=confirmation-failed";
  return NextResponse.redirect(redirectUrl);
}
