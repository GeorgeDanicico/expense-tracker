import { ValueWithChange } from "@/components/ui/value-with-change";
import type { NetWorthEntry } from "@/lib/net-worth/types";

export function NetWorthValue({ entry }: { entry: NetWorthEntry }) {
  return (
    <ValueWithChange
      value={entry.currentValue}
      currency={entry.currency}
      change={entry.comparison?.amount ?? null}
      changeLabel={entry.comparison?.label ?? null}
      changeTone={entry.comparison?.tone ?? "neutral"}
    />
  );
}
