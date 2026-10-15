import "server-only";

import { cache } from "react";

import { isFamilyEnabled } from "@/lib/features";
import type { CurrentMember } from "@/lib/family/repository";
import { getRepositories } from "@/lib/repositories";

/**
 * The signed-in user's family membership, read once per request. `null` when they have no family,
 * and always `null`, without any query, while the family flag is off. Pass it to `can()`.
 */
export const getCurrentMember = cache(async (): Promise<CurrentMember | null> => {
  if (!isFamilyEnabled()) return null;
  return getRepositories().family.getMembership();
});
