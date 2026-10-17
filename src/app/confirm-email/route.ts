import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getAuth } from "@/lib/auth";
import { siteOrigin } from "@/lib/http/origin";

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
  // Not request.nextUrl.origin: behind the container's HOSTNAME=0.0.0.0 that would be http://0.0.0.0:3000.
  const origin = siteOrigin(request);
  const failed = new URL("/login?message=confirmation-failed", origin);

  if (!parsed.success) return NextResponse.redirect(failed);

  const { ok } = await getAuth().completeEmailLink(parsed.data);

  return NextResponse.redirect(ok ? new URL("/dashboard", origin) : failed);
}
