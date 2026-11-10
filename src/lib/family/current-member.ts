import "server-only";

import { isFamilyEnabled } from "@/lib/features";
import type { CurrentMember } from "@/lib/family/repository";
import { getRepositories } from "@/lib/repositories";
import { MEMO_KEYS, oncePerRequest } from "@/lib/request-memo";

/**
 * The signed-in user's family membership. `null` when they have no family, and always `null`,
 * without any query, while the family flag is off. Pass it to `can()`. Read once per request
 * (`oncePerRequest`): the permission check, the handler and the MCP tools share it.
 */
export async function getCurrentMember(): Promise<CurrentMember | null> {
  if (!isFamilyEnabled()) return null;
  return oncePerRequest(MEMO_KEYS.membership, () => getRepositories().family.getMembership());
}
