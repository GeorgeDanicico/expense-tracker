import "server-only";

import { cache } from "react";

import type { AuthAdmin } from "@/lib/auth/admin";
import type { AuthenticatedUser, AuthService } from "@/lib/auth/service";
import { supabaseAuth } from "@/lib/supabase/auth";
import { createSupabaseAuthAdmin } from "@/lib/supabase/auth-admin";

export type * from "@/lib/auth/admin";
export type * from "@/lib/auth/service";

/** The auth provider for this request. The only place that picks the implementation. */
export function getAuth(): AuthService {
  return supabaseAuth;
}

/**
 * Admin access to the auth provider. The only place that picks the implementation.
 *
 * SECURITY: it uses the secret key, which bypasses every database rule. Check the caller's
 * permission before calling it. Throws when `SUPABASE_SECRET_KEY` isn't set, so call it inside
 * the handler that needs it, never at module level.
 */
export function getAuthAdmin(): AuthAdmin {
  return createSupabaseAuthAdmin();
}

/** The signed-in user, read once per request. */
export const getAuthenticatedUser = cache(async (): Promise<AuthenticatedUser | null> => getAuth().getCurrentUser());

// [p1-spike] Supabase OAuth server pieces for the spike only; M3 puts them behind real interfaces.
export {
  decideConsent as spikeDecideConsent,
  getAuthIssuer as spikeAuthIssuer,
  getConsentRequest as spikeConsentRequest,
  listGrants as spikeListGrants,
  revokeGrant as spikeRevokeGrant,
  sessionForAppToken as spikeSessionForAppToken,
  type SpikeConsentRequest,
} from "@/lib/supabase/oauth-spike";
