"use client";

import { Button } from "@chakra-ui/react";
import { FileUp } from "lucide-react";
import Link from "next/link";

import { ICON, ICON_STROKE } from "@/components/ui/icon";

/** Where the statement import lives (`src/app/(app)/expenses/import`). */
export const IMPORT_PAGE_HREF = "/expenses/import";

/**
 * The Expenses header's way into the statement import. It has no permission check of its own: the
 * page it sits on is behind `PermissionGate module="expenses"`, and the import page and its routes
 * check the same permission again.
 */
export function ImportStatementButton() {
  return (
    // On a phone it shares the row with Add expense, each at least as wide as its label, so Export wraps
    // to the next line rather than a label being squeezed.
    <Button asChild variant="outline" size={{ base: "md", sm: "sm" }} flex={{ base: "1 0 auto", sm: "initial" }}>
      <Link href={IMPORT_PAGE_HREF}>
        <FileUp size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Import statement
      </Link>
    </Button>
  );
}
