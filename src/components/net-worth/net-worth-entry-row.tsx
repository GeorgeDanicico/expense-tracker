import { Button, Text } from "@chakra-ui/react";
import { Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AddNetWorthValuationDialog } from "@/components/net-worth/add-net-worth-valuation-dialog";
import { EditNetWorthItemDialog } from "@/components/net-worth/edit-net-worth-item-dialog";
import { NetWorthValue } from "@/components/net-worth/net-worth-value";
import type { StatusTone } from "@/components/ui/status-badge";
import { ListRow } from "@/components/ui/list-row";
import { RowActions, useRowActions, type RowAction } from "@/components/ui/row-actions";
import { useViewing } from "@/hooks/use-viewing";
import type { NetWorthEntry } from "@/lib/net-worth/types";
import { formatDate, formatDateTime } from "@/lib/calendar";

export function entryAnchor(id: string) {
  return `net-worth-entry-${id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function entryStatus(entry: NetWorthEntry): { label: string; tone: StatusTone } {
  if (entry.status === "current") return { label: "Current quote", tone: "positive" };
  if (entry.status === "manual") return { label: "Manual value", tone: "neutral" };
  if (entry.status === "currency_mismatch") return { label: "Currency mismatch", tone: "warning" };
  if (entry.status === "missing_quote") return { label: "Quote unavailable", tone: "warning" };
  return { label: "Value needed", tone: "warning" };
}

function entryDate(entry: NetWorthEntry) {
  if (!entry.valuedOn) return "No valuation date";
  return entry.source === "investment"
    ? `Quote as of ${formatDateTime(entry.valuedOn)}`
    : `Valued ${formatDate(entry.valuedOn)}`;
}

/**
 * One balance-sheet line: name, meta, value with its change. A manual item's `⋯` (hover icons on
 * desktop, long-press on phones) holds Add value and Edit details, each a sheet; an investment links
 * to its page. A status that needs attention is said in the caption.
 */
export function NetWorthEntryRow({ entry }: { entry: NetWorthEntry }) {
  const { hrefFor, readOnly } = useViewing();
  const { rowProps, menu } = useRowActions();
  const [sheet, setSheet] = useState<"value" | "details" | null>(null);
  const status = entryStatus(entry);
  const meta = [status.tone === "warning" ? status.label : null, entry.reference, entry.currency, entryDate(entry)].filter(Boolean).join(" · ");
  const actions: RowAction[] | null = entry.source === "manual" && !readOnly
    ? [
        { label: "Add value", icon: Plus, onSelect: () => setSheet("value") },
        { label: "Edit details", icon: Pencil, onSelect: () => setSheet("details") },
      ]
    : null;

  return (
    <ListRow
      id={entryAnchor(entry.id)}
      {...(actions ? rowProps : {})}
      style={{ scrollMarginTop: "1rem" }}
      title={entry.name}
      meta={meta}
      trailing={
        <>
          {entry.source === "investment" ? (
            <Button asChild size="xs" variant="ghost" color="fg.muted" flexShrink="0">
              <Link href={hrefFor("/investments")}>View →</Link>
            </Button>
          ) : null}
          {actions ? <RowActions label={entry.name} actions={actions} {...menu} /> : null}
          <Text textStyle="amount" textAlign="end" wordBreak="break-word">
            <NetWorthValue entry={entry} />
          </Text>
          {actions ? (
            <>
              <AddNetWorthValuationDialog entry={entry} open={sheet === "value"} onOpenChange={(open) => setSheet(open ? "value" : null)} />
              <EditNetWorthItemDialog entry={entry} open={sheet === "details"} onOpenChange={(open) => setSheet(open ? "details" : null)} />
            </>
          ) : null}
        </>
      }
    />
  );
}
