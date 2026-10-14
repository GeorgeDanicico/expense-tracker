import type { NextRequest } from "next/server";
import { z } from "zod";

import { json } from "@/lib/http/route";
import { createClient } from "@/lib/supabase/server";

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
    return json(
      {
        error: "Check the highlighted details and try again.",
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      422,
    );
  }

  const supabase = await createClient();
  if (parsed.data.mode === "login") {
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.data.email,
      password: parsed.data.password,
    });
    if (error) {
      return json({ error: "Email or password is incorrect." }, 401);
    }
    return json({ authenticated: true });
  }

  const confirmationUrl = new URL("/auth/confirm", confirmationOrigin(request));
  confirmationUrl.searchParams.set("next", "/dashboard");
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: confirmationUrl.toString() },
  });

  if (error) {
    return json({ error: error.message }, 400);
  }

  return json(
    data.session
      ? { authenticated: true }
      : { authenticated: false, message: "Check your inbox to confirm your email, then sign in." },
  );
}

export async function DELETE() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return json({ error: "Unable to sign out. Please try again." }, 500);
  }
  return json({ success: true });
}
