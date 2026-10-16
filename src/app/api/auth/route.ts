import type { NextRequest } from "next/server";
import { z } from "zod";

import { getAuth, getAuthAdmin } from "@/lib/auth";
import { safeNextPath, siteOrigin } from "@/lib/http/origin";
import { json } from "@/lib/http/route";
import { usernameSchema } from "@/lib/validation/family";

const emailSchema = z.email("Enter a valid email address.");

const authSchema = z.object({
  mode: z.enum(["login", "signup"]),
  email: emailSchema,
  password: z.string().min(8, "Password must contain at least 8 characters.").max(128),
  /** Where the confirmation link leads after sign-up (for example a `/join/<code>` link). */
  next: z.string().max(200).optional(),
});

/**
 * Sign-in also takes a username (kid accounts have no real email). The field keeps its `email`
 * name; its value becomes either `{ email }`, untouched, or `{ username }`, lowercased.
 */
const signInNameSchema = z
  .string({ error: "Enter a valid email address or username." })
  .transform((value, context): { email: string } | { username: string } => {
    const email = emailSchema.safeParse(value);
    if (email.success) return { email: email.data };
    const username = usernameSchema.safeParse(value);
    if (username.success) return { username: username.data };
    context.addIssue({ code: "custom", message: "Enter a valid email address or username." });
    return z.NEVER;
  });

const loginSchema = authSchema.extend({ mode: z.literal("login"), email: signInNameSchema });
const loginRequest = z.object({ mode: z.literal("login") });

const SIGN_IN_FAILED = "Email or password is incorrect.";

function invalidBody(error: z.ZodError) {
  return json(
    {
      error: "Check the highlighted details and try again.",
      fieldErrors: error.flatten().fieldErrors,
    },
    422,
  );
}

/**
 * The email of a username account, or null. A failed lookup (no secret key, provider error) counts
 * as an unknown username, so it answers like a wrong password and email sign-in keeps working.
 * Nothing is logged: neither the username nor the password may end up in the logs.
 */
async function emailForUsername(username: string): Promise<string | null> {
  try {
    return await getAuthAdmin().findEmailByUsername(username);
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);

  if (loginRequest.safeParse(payload).success) {
    const parsed = loginSchema.safeParse(payload);
    if (!parsed.success) return invalidBody(parsed.error);

    const { email: signInName, password } = parsed.data;
    // An unknown username answers exactly like a wrong password, so usernames can't be probed.
    const email = "email" in signInName ? signInName.email : await emailForUsername(signInName.username);
    const signIn = email === null ? null : await getAuth().signInWithPassword(email, password);
    if (!signIn?.ok) {
      return json({ error: SIGN_IN_FAILED }, 401);
    }
    return json({ authenticated: true });
  }

  const parsed = authSchema.safeParse(payload);
  if (!parsed.success) return invalidBody(parsed.error);

  const confirmationUrl = new URL("/auth/confirm", siteOrigin(request));
  confirmationUrl.searchParams.set("next", safeNextPath(parsed.data.next));
  const signUp = await getAuth().signUp(parsed.data.email, parsed.data.password, confirmationUrl.toString());

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
