"use client";

import { STABLE_DATA } from "@/lib/api/stable-data";
import { FAMILY_API_KEY, type FamilyResponse } from "@/lib/api/keys";
import { useServerFirstSWR } from "@/lib/api/server-fallback";

/**
 * The shared family list (`/api/family`: members, roles, colours), or nothing while `enabled` is
 * false (no family, or the caller doesn't need it). Stable data (`STABLE_DATA`): one request per
 * visit to the app, not one per page. The family settings pages read the same key with plain `useSWR`
 * on purpose, so opening them shows the newest list and every other reader gets it too.
 */
export function useFamily(enabled: boolean) {
  return useServerFirstSWR<FamilyResponse>(enabled ? FAMILY_API_KEY : null, STABLE_DATA);
}
