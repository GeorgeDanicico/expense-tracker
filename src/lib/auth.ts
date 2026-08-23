import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type AuthenticatedUser = {
  id: string;
  email: string;
};

export const getAuthenticatedUser = cache(async (): Promise<AuthenticatedUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error || !data?.claims?.sub) {
    return null;
  }

  return {
    id: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : "",
  };
});
