"use client";

import { useAccount } from "@/hooks/use-account";
import { can, type ModuleKey, type PermissionLevel } from "@/lib/permissions";

/**
 * Whether the signed-in user may use `module` at `level` or above, read from the account's
 * membership. `false` until the account has loaded (or when it fails to load). With no family
 * (`membership: null`, always the case while the flag is off) every check passes, as `can(null, …)` does.
 */
export function useCan(module: ModuleKey, level: PermissionLevel): boolean {
  const { account } = useAccount();
  if (!account) return false;
  return can(account.membership, module, level);
}
