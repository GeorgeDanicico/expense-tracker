"use client";

import { Button, Input, Stack, Text } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";

import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { TODO_STATUS_LABELS, type TodoStatus } from "@/lib/todos/types";

/**
 * "Add a card" at the top of a column. Enter adds the card and keeps the field open for the next
 * one; Escape (or leaving it empty) closes it.
 */
export function TodoQuickAdd({
  status,
  onAdd,
}: {
  status: TodoStatus;
  /** A returned string is shown under the field as a notice (the new card is hidden by a filter). */
  onAdd: (title: string, status: TodoStatus) => Promise<string | void>;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const label = `Add a card to ${TODO_STATUS_LABELS[status]}`;

  function close() {
    setOpen(false);
    setTitle("");
    setError("");
    setNotice("");
    requestAnimationFrame(() => button.current?.focus());
  }

  async function submit() {
    const trimmed = title.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError("");
    try {
      const added = await onAdd(trimmed, status);
      setNotice(typeof added === "string" ? added : "");
      setTitle("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The card could not be added.");
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button
        ref={button}
        variant="ghost"
        size="sm"
        justifyContent="flex-start"
        color="fg.muted"
        width="full"
        onClick={() => setOpen(true)}
        aria-label={label}
      >
        <Plus size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Add a card
      </Button>
    );
  }

  return (
    <Stack gap="1">
      <Input
        size="sm"
        autoFocus
        value={title}
        maxLength={200}
        placeholder="What needs doing?"
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-busy={pending || undefined}
        onChange={(event) => {
          setTitle(event.target.value);
          setNotice("");
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
        }}
        onBlur={() => {
          if (!title.trim() && !pending) close();
        }}
      />
      {error ? (
        <Text textStyle="caption" color="fg.error" role="alert">{error}</Text>
      ) : (
        // A status region, so "Added — hidden by the Overdue filter." is announced.
        <Text textStyle="caption" color={notice ? "fg" : undefined} role="status">
          {notice || "Enter to add, Escape to cancel."}
        </Text>
      )}
    </Stack>
  );
}
