"use client";

import { Button } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";

import { deleteExpenseAction } from "@/app/(app)/expenses/actions";

export function DeleteExpenseButton({ id, description }: { id: string; description: string }) {
  return (
    <form
      action={deleteExpenseAction}
      onSubmit={(event) => {
        if (!window.confirm(`Delete “${description}”? This cannot be undone.`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="expenseId" value={id} />
      <Button
        type="submit"
        size="xs"
        variant="ghost"
        colorPalette="red"
        aria-label={`Delete ${description}`}
      >
        <Trash2 size={15} aria-hidden="true" />
      </Button>
    </form>
  );
}
