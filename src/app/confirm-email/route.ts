import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp(parsed.data);

  redirectUrl.pathname = error ? "/login" : "/dashboard";
  redirectUrl.search = error ? "message=confirmation-failed" : "";
  return NextResponse.redirect(redirectUrl);
}
