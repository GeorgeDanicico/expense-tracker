import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const authSchema = z.object({
  mode: z.enum(["login", "signup"]),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must contain at least 8 characters.").max(128),
});

function confirmationOrigin(request: NextRequest) {
  const configuredOrigin = process.env.SITE_URL;
  const candidate = process.env.NODE_ENV === "production"
    ? configuredOrigin || request.nextUrl.origin
    : request.nextUrl.origin || configuredOrigin;

  try {
    return new URL(candidate || "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const parsed = authSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Check the highlighted details and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 422, headers: PRIVATE_HEADERS },
    );
  }

  const supabase = await createClient();
  if (parsed.data.mode === "login") {
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error) {
      return NextResponse.json(
        { error: "Email or password is incorrect." },
        { status: 401, headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json({ authenticated: true }, { headers: PRIVATE_HEADERS });
  }

  const confirmationUrl = new URL("/auth/confirm", confirmationOrigin(request));
  confirmationUrl.searchParams.set("next", "/dashboard");
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: confirmationUrl.toString() },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400, headers: PRIVATE_HEADERS });
  }

  return NextResponse.json(
    data.session
      ? { authenticated: true }
      : { authenticated: false, message: "Check your inbox to confirm your email, then sign in." },
    { headers: PRIVATE_HEADERS },
  );
}

export async function DELETE() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return NextResponse.json(
      { error: "Unable to sign out. Please try again." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
  return NextResponse.json({ success: true }, { headers: PRIVATE_HEADERS });
}
