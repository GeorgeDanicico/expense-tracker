import { Suspense } from "react";

import { PermissionGate } from "@/components/layout/permission-gate";
import { InvestmentsPanel } from "@/components/investments/investments-panel";
import { DataLoading } from "@/components/ui/data-state";

export default function InvestmentsPage() {
  return (
    <PermissionGate module="investments">
      <Suspense fallback={<DataLoading label="Loading your investments…" />}>
        <InvestmentsPanel />
      </Suspense>
    </PermissionGate>
  );
}
