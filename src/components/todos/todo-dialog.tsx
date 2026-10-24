"use client";

import { Button, Flex, Input, NativeSelect, Stack, Textarea } from "@chakra-ui/react";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import type { TodoChanges } from "@/components/todos/todo-api";
import { AppDialog } from "@/components/ui/app-dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import type { FamilyMember } from "@/lib/family/repository";
import { TODO_STATUS_LABELS, type Todo } from "@/lib/todos/types";

type Draft = { title: string; notes: string; assigneeMemberId: string; dueDate: string };

/** The fields of `draft` that differ from `todo`, as the PATCH takes them; empty when nothing changed. */
export function todoChanges(todo: Todo, draft: Draft): TodoChanges {
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

function memberName(member: FamilyMember) {
  return member.displayName ?? member.username ?? "Family member";
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
  members: readonly FamilyMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, changes: TodoChanges) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}) {
  const form = useApiForm();
  const removal = useApiForm();
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState<Draft>({
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
            <FormField label="Title" error={form.fieldError("title")}>
              <Input
                name="title"
                value={draft.title}
                maxLength={200}
                required
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </FormField>
            <FormField label="Notes" optional error={form.fieldError("notes")}>
              <Textarea
                name="notes"
                value={draft.notes}
                maxLength={2000}
                rows={4}
                resize="vertical"
                placeholder="Add details"
                onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              />
            </FormField>
            <Flex gap="3" direction={{ base: "column", sm: "row" }}>
              <FormField flex="1" label="Assignee" optional error={form.fieldError("assigneeMemberId")}>
                <NativeSelect.Root>
                  <NativeSelect.Field
                    name="assigneeMemberId"
                    value={draft.assigneeMemberId}
                    onChange={(event) => setDraft({ ...draft, assigneeMemberId: event.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {members.map((member) => (
                      <option key={member.memberId} value={member.memberId}>{memberName(member)}</option>
                    ))}
                    {assigneeMissing && todo.assignee ? (
                      <option value={todo.assignee.memberId}>{todo.assignee.name ?? "Family member"}</option>
                    ) : null}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </FormField>
              <FormField flex="1" label="Due date" optional error={form.fieldError("dueDate")}>
                <Flex gap="1" align="center">
                  <Input
                    name="dueDate"
                    type="date"
                    value={draft.dueDate}
                    onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
                  />
                  {draft.dueDate ? (
                    <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, dueDate: "" })} aria-label="Clear the due date">
                      Clear
                    </Button>
                  ) : null}
                </Flex>
              </FormField>
            </Flex>
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
