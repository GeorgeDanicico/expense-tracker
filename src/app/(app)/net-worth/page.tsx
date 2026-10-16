import { Suspense } from "react";

import { PermissionGate } from "@/components/layout/permission-gate";
import { NetWorthPanel } from "@/components/net-worth/net-worth-panel";
import { DataLoading } from "@/components/ui/data-state";

export default function NetWorthPage() {
  return (
    <PermissionGate module="net_worth">
      <Suspense fallback={<DataLoading label="Loading your net worth…" />}>
        <NetWorthPanel />
      </Suspense>
    </PermissionGate>
  );
}
