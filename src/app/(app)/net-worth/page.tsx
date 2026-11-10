import { Suspense } from "react";

import { PermissionGate } from "@/components/layout/permission-gate";
import { NetWorthPanel } from "@/components/net-worth/net-worth-panel";
import { PanelSkeleton } from "@/components/ui/skeletons";

export default function NetWorthPage() {
  return (
    <PermissionGate module="net_worth">
      <Suspense fallback={<PanelSkeleton title="Net worth" label="Loading your net worth…" />}>
        <NetWorthPanel />
      </Suspense>
    </PermissionGate>
  );
}
