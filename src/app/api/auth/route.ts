import type { NextRequest } from "next/server";
import { z } from "zod";

import { getAuth, getAuthAdmin } from "@/lib/auth";
import { KID_EMAIL_DOMAIN, UNKNOWN_USERNAME_EMAIL } from "@/lib/family/kid-account";
import { clientIp } from "@/lib/http/client-ip";
import { safeNextPath, siteOrigin } from "@/lib/http/origin";
import {
  signInIpFailures,
  signInNameFailures,
  signUpAttempts,
  TOO_MANY_SIGN_INS,
  TOO_MANY_SIGN_UPS,
} from "@/lib/http/rate-limit";
import { json, readJson, tooManyRequests, withRequestGuard } from "@/lib/http/route";
import { usernameSchema } from "@/lib/validation/family";

const emailSchema = z.email("Enter a valid email address.");

const authSchema = z.object({
  mode: z.enum(["login", "signup"]),
  // Generated kid addresses (and `UNKNOWN_USERNAME_EMAIL`) can only ever be made by a parent.
  email: emailSchema.refine(
    (value) => !value.toLowerCase().endsWith(`@${KID_EMAIL_DOMAIN}`),
    "Enter a valid email address.",
  ),
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

/** The key the sign-in limit counts a name under: the email lowercased, or the (already lowercase) username. */
function signInKey(signInName: { email: string } | { username: string }) {
  return "email" in signInName ? `email:${signInName.email.toLowerCase()}` : `username:${signInName.username}`;
}

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

/**
 * Signs in (`mode: "login"`, with an email or a username) or signs up. Not behind `withUser`, but
 * behind the same request guard: a sign-in posted from another site is a 403 (login CSRF), and the
 * body must be `application/json` of at most 64 KB (415 / 413).
 */
export const POST = withRequestGuard(async (request: NextRequest) => {
  const payload = await readJson(request);
  const ip = clientIp(request);

  if (loginRequest.safeParse(payload).success) {
    const parsed = loginSchema.safeParse(payload);
    if (!parsed.success) return invalidBody(parsed.error);

    const { email: signInName, password } = parsed.data;
    // Both limits are checked before the provider (or the username lookup) is asked anything.
    const nameKey = signInKey(signInName);
    const wait = Math.max(signInNameFailures.retryAfterSeconds(nameKey), ip ? signInIpFailures.retryAfterSeconds(ip) : 0);
    if (wait > 0) return tooManyRequests(TOO_MANY_SIGN_INS, wait);

    // An unknown username answers exactly like a wrong password, so usernames can't be probed: it
    // still signs in, against an address no account has, so it also takes about as long (audit B7).
    const email = "email" in signInName ? signInName.email : await emailForUsername(signInName.username);
    const signIn = await getAuth().signInWithPassword(email ?? UNKNOWN_USERNAME_EMAIL, password);
    if (signIn.ok && email !== null) return json({ authenticated: true });

    if (signIn.ok) {
      // The unknown-username address signed in. Sign-up refuses it, so this can't happen; if it
      // ever did, drop the session and answer like any wrong password.
      await getAuth().signOut("local");
    } else if (signIn.kind === "rate_limited") {
      return json({ error: signIn.reason }, 429);
    } else if (signIn.kind === "email_not_confirmed") {
      // The provider only says this after checking the password, so it reveals nothing to someone
      // guessing. Any other refusal reads like a wrong password.
      return json({ error: signIn.reason }, 403);
    }
    signInNameFailures.recordFailure(nameKey);
    if (ip) signInIpFailures.recordFailure(ip);
    return json({ error: SIGN_IN_FAILED }, 401);
  }

  const wait = ip ? signUpAttempts.retryAfterSeconds(ip) : 0;
  if (wait > 0) return tooManyRequests(TOO_MANY_SIGN_UPS, wait);

  const parsed = authSchema.safeParse(payload);
  if (!parsed.success) return invalidBody(parsed.error);
  // Every sign-up that reaches the provider counts, since each one can send an email.
  if (ip) signUpAttempts.recordAttempt(ip);

  const confirmationUrl = new URL("/auth/confirm", siteOrigin(request));
  confirmationUrl.searchParams.set("next", safeNextPath(parsed.data.next));
  const signUp = await getAuth().signUp(parsed.data.email, parsed.data.password, confirmationUrl.toString());

  if (!signUp.ok) {
    return json({ error: signUp.reason }, signUp.kind === "rate_limited" ? 429 : 400);
  }

  return json(
    signUp.signedIn
      ? { authenticated: true }
      : { authenticated: false, message: "Check your inbox to confirm your email, then sign in." },
  );
});

/**
 * Signs out: this browser only, or with `?scope=global` every session of the account ("Sign out
 * everywhere" in Settings: other browsers, phones and connected apps). Behind the request guard, so
 * another site can't sign the user out either. Not behind `withUser`, so an account that must choose
 * a new password can still sign out.
 */
export const DELETE = withRequestGuard(async (request: NextRequest) => {
  const scope = request.nextUrl.searchParams.get("scope");
  if (scope !== null && scope !== "global") return json({ error: "Unknown sign-out scope." }, 422);

  const signOut = await getAuth().signOut(scope === "global" ? "global" : "local");
  if (!signOut.ok) {
    return json({ error: "Unable to sign out. Please try again." }, 500);
  }
  return json({ success: true });
});
