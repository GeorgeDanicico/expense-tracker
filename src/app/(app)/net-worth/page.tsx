import { PermissionGate } from "@/components/layout/permission-gate";
import { NetWorthPanel } from "@/components/net-worth/net-worth-panel";

export default function NetWorthPage() {
  return (
    <PermissionGate module="net_worth">
      <NetWorthPanel />
    </PermissionGate>
  );
}
