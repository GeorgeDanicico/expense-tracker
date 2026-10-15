import "server-only";

import { cache } from "react";

import type { AuthenticatedUser, AuthService } from "@/lib/auth/service";
import { supabaseAuth } from "@/lib/supabase/auth";

export type * from "@/lib/auth/service";

/** The auth provider for this request. The only place that picks the implementation. */
export function getAuth(): AuthService {
  return supabaseAuth;
}

/** The signed-in user, read once per request. */
export const getAuthenticatedUser = cache(async (): Promise<AuthenticatedUser | null> => getAuth().getCurrentUser());
