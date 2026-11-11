"use client";

import { Button, Flex, Input, NativeSelect, Stack, Text, Textarea } from "@chakra-ui/react";
import { useState, type ReactNode } from "react";
import { useSWRConfig } from "swr";

import { useTodoApi } from "@/components/todos/todo-api";
import { ChipMenu } from "@/components/ui/chip-menu";
import { FormField } from "@/components/ui/form-field";
import { SheetForm, useSheetSave } from "@/components/ui/save-button";
import { useAccount } from "@/hooks/use-account";
import { useFamily } from "@/hooks/use-family";
import { isTodosKey, type TodosResponse } from "@/lib/api/keys";
import { addDays, formatShortDate, getBucharestToday } from "@/lib/calendar";
import type { FamilyMemberView } from "@/lib/family/views";
import { upsertTodo } from "@/lib/todos/board";
import { TODO_STATUS_LABELS, type Todo, type TodoStatus } from "@/lib/todos/types";

/** A card's fields as typed: empty strings for no assignee and no due date. */
export type TodoDraft = { title: string; notes: string; assigneeMemberId: string; dueDate: string };

function memberName(member: FamilyMemberView) {
  return member.displayName ?? member.username ?? "Family member";
}

const PICK_DATE = "pick";
const NEW_CARD_COLUMNS: TodoStatus[] = ["todo", "in_progress"];

/**
 * A card's fields, the one form for a to-do. In full (the card's dialog): title, notes, assignee
 * and due date. `compact` (the quick-add sheet): the title, then the assignee and due date as chips
 * with defaults; notes are left for the card. `extraAssignee` keeps a former member who is still
 * assigned visible in the choices.
 */
export function TodoFields({
  draft,
  onChange,
  members,
  myMemberId = null,
  fieldError,
  compact = false,
  chips,
  extraAssignee,
}: {
  draft: TodoDraft;
  onChange: (draft: TodoDraft) => void;
  members: readonly FamilyMemberView[];
  myMemberId?: string | null;
  fieldError: (name: string) => string | undefined;
  compact?: boolean;
  /** More chips before the assignee's, in compact mode (the quick-add column). */
  chips?: ReactNode;
  extraAssignee?: { memberId: string; name: string | null };
}) {
  const [pickingDate, setPickingDate] = useState(false);
  const title = (
    <FormField label="Title" labelHidden={compact} error={fieldError("title")}>
      <Input
        name="title"
        size={compact ? "md" : undefined}
        value={draft.title}
        maxLength={200}
        required
        autoFocus={compact}
        enterKeyHint={compact ? "done" : undefined}
        placeholder={compact ? "What needs doing?" : undefined}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
      />
    </FormField>
  );

  if (compact) {
    const today = getBucharestToday();
    const tomorrow = addDays(today, 1);
    const assignee = members.find((member) => member.memberId === draft.assigneeMemberId);
    const dueLabel = !draft.dueDate ? "No due date" : draft.dueDate === today ? "Due today" : draft.dueDate === tomorrow ? "Due tomorrow" : `Due ${formatShortDate(draft.dueDate)}`;
    return (
      <Stack gap="3">
        {title}
        <Flex gap="2" wrap="wrap">
          {chips}
          <ChipMenu
            aria-label={`Assignee: ${assignee ? memberName(assignee) : "nobody"}`}
            label={assignee ? `Assign: ${assignee.memberId === myMemberId ? "Me" : memberName(assignee)}` : "Unassigned"}
            selected={Boolean(assignee)}
            items={[
              { value: "", label: "Unassigned" },
              ...members.map((member) => ({ value: member.memberId, label: member.memberId === myMemberId ? "Me" : memberName(member) })),
            ]}
            onSelect={(assigneeMemberId) => onChange({ ...draft, assigneeMemberId })}
          />
          <ChipMenu
            aria-label={`Due date: ${dueLabel}`}
            label={dueLabel}
            selected={Boolean(draft.dueDate)}
            items={[
              { value: "", label: "No due date" },
              { value: today, label: "Today" },
              { value: tomorrow, label: "Tomorrow" },
              { value: PICK_DATE, label: "Pick a date…" },
            ]}
            onSelect={(value) => {
              setPickingDate(value === PICK_DATE);
              if (value !== PICK_DATE) onChange({ ...draft, dueDate: value });
            }}
          />
        </Flex>
        {pickingDate || fieldError("dueDate") ? (
          <FormField label="Due date" error={fieldError("dueDate")}>
            <Input name="dueDate" type="date" size="md" value={draft.dueDate} onChange={(event) => onChange({ ...draft, dueDate: event.target.value })} />
          </FormField>
        ) : null}
        <Text textStyle="caption">Enter adds it. Notes are on the card.</Text>
      </Stack>
    );
  }

  return (
    <Stack gap="3">
      {title}
      <FormField label="Notes" optional error={fieldError("notes")}>
        <Textarea
          name="notes"
          value={draft.notes}
          maxLength={2000}
          rows={4}
          resize="vertical"
          placeholder="Add details"
          onChange={(event) => onChange({ ...draft, notes: event.target.value })}
        />
      </FormField>
      <Flex gap="3" direction={{ base: "column", sm: "row" }}>
        <FormField flex="1" label="Assignee" optional error={fieldError("assigneeMemberId")}>
          <NativeSelect.Root>
            <NativeSelect.Field
              name="assigneeMemberId"
              value={draft.assigneeMemberId}
              onChange={(event) => onChange({ ...draft, assigneeMemberId: event.target.value })}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.memberId} value={member.memberId}>{memberName(member)}</option>
              ))}
              {extraAssignee ? <option value={extraAssignee.memberId}>{extraAssignee.name ?? "Family member"}</option> : null}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
        </FormField>
        <FormField flex="1" label="Due date" optional error={fieldError("dueDate")}>
          <Flex gap="1" align="center">
            <Input
              name="dueDate"
              type="date"
              value={draft.dueDate}
              onChange={(event) => onChange({ ...draft, dueDate: event.target.value })}
            />
            {draft.dueDate ? (
              <Button variant="ghost" size="sm" onClick={() => onChange({ ...draft, dueDate: "" })} aria-label="Clear the due date">
                Clear
              </Button>
            ) : null}
          </Flex>
        </FormField>
      </Flex>
    </Stack>
  );
}

/**
 * A new card from the quick-add sheet: `TodoFields` in compact mode plus the column, assigned to
 * you and with no due date unless changed. The new card goes at the top of its column on every
 * cached board.
 */
export function NewTodoForm({ onSaved }: { onSaved: (todo: Todo, another: boolean) => void }) {
  const api = useTodoApi();
  const { mutate } = useSWRConfig();
  const { account } = useAccount();
  const myMemberId = account?.membership?.memberId ?? null;
  const { data: family } = useFamily(Boolean(account?.membership));
  const { form, saved, save: run } = useSheetSave();
  const [status, setStatus] = useState<TodoStatus>("todo");
  const [draft, setDraft] = useState<TodoDraft>({ title: "", notes: "", assigneeMemberId: myMemberId ?? "", dueDate: "" });

  function save(another: boolean) {
    run(another, async () => {
      const todo = await api.create({
        title: draft.title.trim(),
        status,
        assigneeMemberId: draft.assigneeMemberId || null,
        ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
      });
      await mutate(isTodosKey, (current?: TodosResponse) => current && { todos: upsertTodo(current.todos, todo) }, { revalidate: false });
      return todo;
    }, (todo, cleared) => {
      if (cleared) setDraft({ ...draft, title: "" });
      onSaved(todo, cleared);
    });
  }

  return (
    <SheetForm label="Add to-do" form={form} saved={saved} onSave={save}>
      <TodoFields
        compact
        draft={draft}
        onChange={setDraft}
        members={family?.family?.members ?? []}
        myMemberId={myMemberId}
        fieldError={form.fieldError}
        chips={(
          <ChipMenu
            aria-label={`Column: ${TODO_STATUS_LABELS[status]}`}
            label={TODO_STATUS_LABELS[status]}
            items={NEW_CARD_COLUMNS.map((value) => ({ value, label: TODO_STATUS_LABELS[value] }))}
            onSelect={(value) => setStatus(value as TodoStatus)}
          />
        )}
      />
    </SheetForm>
  );
}
