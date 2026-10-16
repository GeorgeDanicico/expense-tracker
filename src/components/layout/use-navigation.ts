"use client";

import { navigationFor } from "@/components/layout/nav-items";
import { useAccount } from "@/hooks/use-account";

/** The navigation the signed-in user can reach, from their family membership. */
export function useNavigation() {
  const { account } = useAccount();
  return navigationFor(account ? account.membership : undefined);
}
