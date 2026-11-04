"use client";

import { Button, Stack } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import type { TodoChanges } from "@/components/todos/todo-api";
import { TodoFields, type TodoDraft } from "@/components/todos/todo-form";
import { AppDialog } from "@/components/ui/app-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import type { FamilyMemberView } from "@/lib/family/views";
import { TODO_STATUS_LABELS, type Todo } from "@/lib/todos/types";

/** The fields of `draft` that differ from `todo`, as the PATCH takes them; empty when nothing changed. */
export function todoChanges(todo: Todo, draft: TodoDraft): TodoChanges {
  const changes: TodoChanges = {};
  const title = draft.title.trim();
  const notes = draft.notes.trim();
  const assignee = draft.assigneeMemberId || null;
  const dueDate = draft.dueDate || null;
  if (title !== todo.title) changes.title = title;
  if (notes !== todo.notes) changes.notes = notes;
  if (assignee !== (todo.assignee?.memberId ?? null)) changes.assigneeMemberId = assignee;
  if (dueDate !== todo.dueDate) changes.dueDate = dueDate;
  return changes;
}

/** Edit a card's title, notes, assignee and due date, or delete it (after a confirmation). */
export function TodoDialog({
  todo,
  members,
  open,
  onOpenChange,
  onSave,
  onDelete,
}: {
  todo: Todo;
  members: readonly FamilyMemberView[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, changes: TodoChanges) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const form = useApiForm();
  const removal = useApiForm();
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<TodoDraft>({
    title: todo.title,
    notes: todo.notes,
    assigneeMemberId: todo.assignee?.memberId ?? "",
    dueDate: todo.dueDate ?? "",
  });
  const formId = `todo-${todo.id}`;
  const assigneeMissing = todo.assignee !== null && !members.some((member) => member.memberId === todo.assignee?.memberId);

  function save() {
    void form.submit(async () => {
      const changes = todoChanges(todo, draft);
      if (Object.keys(changes).length > 0) await onSave(todo.id, changes);
      onOpenChange(false);
    }, { fallback: "The card could not be saved." });
  }

  function remove() {
    void removal.submit(async () => {
      await onDelete(todo.id);
      setConfirming(false);
      onOpenChange(false);
    }, { fallback: "The card could not be deleted." });
  }

  return (
    <>
      <AppDialog
        open={open}
        onOpenChange={(next) => {
          if (!form.pending) onOpenChange(next);
        }}
        title="Edit card"
        description={`Column: ${TODO_STATUS_LABELS[todo.status]}`}
        footer={(
          <FormActions
            submitLabel="Save card"
            form={formId}
            closesDialog
            pending={form.pending}
            leading={(
              <Button variant="ghost" size={{ base: "md", sm: "sm" }} colorPalette="danger" onClick={() => setConfirming(true)} disabled={form.pending}>
                <Trash2 size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Delete
              </Button>
            )}
          />
        )}
      >
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <Stack gap="3">
            <TodoFields
              draft={draft}
              onChange={setDraft}
              members={members}
              fieldError={form.fieldError}
              extraAssignee={assigneeMissing && todo.assignee ? todo.assignee : undefined}
            />
            {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
          </Stack>
        </form>
      </AppDialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={(next) => {
          if (!removal.pending) setConfirming(next);
        }}
        title="Delete this card?"
        description={`“${todo.title}” will be removed from the family board for everyone.`}
        cancelLabel="Keep it"
        confirmLabel="Delete card"
        pending={removal.pending}
        error={removal.error}
        onConfirm={remove}
      />
    </>
  );
}
