"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/types";

const credentialsSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(8, "Password must contain at least 8 characters.").max(128),
});

function parseCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}

function getSiteOrigin(requestHeaders: Headers) {
  const requestOrigin = requestHeaders.get("origin");
  const configuredOrigin = process.env.SITE_URL;
  const candidate =
    process.env.NODE_ENV === "production"
      ? configuredOrigin || requestOrigin
      : requestOrigin || configuredOrigin;

  try {
    return new URL(candidate || "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}

export async function loginAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted details and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return {
      status: "error",
      message: "Email or password is incorrect.",
    };
  }

  redirect("/dashboard");
}

export async function signupAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseCredentials(formData);
  if (!parsed.success) {
    return {
      status: "error",
      message: "Check the highlighted details and try again.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const requestHeaders = await headers();
  const confirmationUrl = new URL("/auth/confirm", getSiteOrigin(requestHeaders));
  confirmationUrl.searchParams.set("next", "/dashboard");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: {
      emailRedirectTo: confirmationUrl.toString(),
    },
  });

  if (error) {
    return {
      status: "error",
      message: error.message,
    };
  }

  if (data.session) {
    redirect("/dashboard");
  }

  return {
    status: "success",
    message: "Check your inbox to confirm your email, then sign in.",
  };
}
