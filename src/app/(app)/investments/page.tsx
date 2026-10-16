import { PermissionGate } from "@/components/layout/permission-gate";
import { InvestmentsPanel } from "@/components/investments/investments-panel";

export default function InvestmentsPage() {
  return (
    <PermissionGate module="investments">
      <InvestmentsPanel />
    </PermissionGate>
  );
}
