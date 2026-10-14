import type { NetWorthItemKind } from "@/lib/net-worth/types";

/** Only non-cash assets record a purchase amount; liabilities and cash never do. */
export function purchaseAmountAllowed(kind: NetWorthItemKind, category: string) {
  return kind === "asset" && category !== "cash";
}
