"use client";

import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { DataError, DataLoading } from "@/components/ui/data-state";
import { EmptyState } from "@/components/ui/empty-state";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { useAccount } from "@/hooks/use-account";
import { useCan } from "@/hooks/use-can";
import type { ModuleKey, PermissionLevel } from "@/lib/permissions";

/**
 * Shows `children` when the user may use `module` at `level`, and a short message otherwise. The
 * children aren't rendered until access is confirmed, so a refused page makes no requests. The
 * server enforces the same rule; this only keeps the screen honest.
 */
export function PermissionGate({
  module,
  level = "edit",
  children,
}: {
  module: ModuleKey;
  level?: PermissionLevel;
  children: ReactNode;
}) {
  const { account, error, isLoading, mutate } = useAccount();
  const allowed = useCan(module, level);
  if (allowed) return <>{children}</>;
  if (!account) {
    return error && !isLoading ? (
      <DataError message="Your account could not be loaded." retry={() => void mutate()} />
    ) : (
      <DataLoading label="Loading…" />
    );
  }
  return (
    <EmptyState
      icon={<Lock size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" />}
      title="This part of the app is turned off for you. Ask a parent."
      titleAs="p"
    />
  );
}
