import { Suspense } from "react";

import { PermissionGate } from "@/components/layout/permission-gate";
import { InvestmentsPanel } from "@/components/investments/investments-panel";
import { PanelSkeleton } from "@/components/ui/skeletons";

export default function InvestmentsPage() {
  return (
    <PermissionGate module="investments">
      <Suspense fallback={<PanelSkeleton title="Investments" label="Loading your investments…" />}>
        <InvestmentsPanel />
      </Suspense>
    </PermissionGate>
  );
}
