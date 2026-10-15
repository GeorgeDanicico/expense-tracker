import type { NextRequest } from "next/server";
import { z } from "zod";

import { getAuth } from "@/lib/auth";
import { siteOrigin } from "@/lib/http/origin";
import { json } from "@/lib/http/route";

const authSchema = z.object({
  mode: z.enum(["login", "signup"]),
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must contain at least 8 characters.").max(128),
});

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

  const auth = getAuth();
  if (parsed.data.mode === "login") {
    const signIn = await auth.signInWithPassword(parsed.data.email, parsed.data.password);
    if (!signIn.ok) {
      return json({ error: "Email or password is incorrect." }, 401);
    }
    return json({ authenticated: true });
  }

  const confirmationUrl = new URL("/auth/confirm", siteOrigin(request));
  confirmationUrl.searchParams.set("next", "/dashboard");
  const signUp = await auth.signUp(parsed.data.email, parsed.data.password, confirmationUrl.toString());

  if (!signUp.ok) {
    return json({ error: signUp.reason }, 400);
  }

  return json(
    signUp.signedIn
      ? { authenticated: true }
      : { authenticated: false, message: "Check your inbox to confirm your email, then sign in." },
  );
}

export async function DELETE() {
  const signOut = await getAuth().signOut();
  if (!signOut.ok) {
    return json({ error: "Unable to sign out. Please try again." }, 500);
  }
  return json({ success: true });
}
