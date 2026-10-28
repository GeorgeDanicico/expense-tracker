"use client";

import { Button, Stack, Text } from "@chakra-ui/react";

import { AppDialog } from "@/components/ui/app-dialog";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { CalendarEvent, EditScope } from "@/lib/family-calendar/types";

export type ScopeAction = "edit" | "delete";

/** The three answers for an occurrence `index` of `length`: what each one reaches, in words. */
export function scopeChoices(event: Pick<CalendarEvent, "seriesIndex" | "seriesLength">): { scope: EditScope; label: string; description: string }[] {
  const { seriesIndex: index, seriesLength: length } = event;
  const following = length - index + 1;
  return [
    { scope: "this", label: "This event", description: `Only event ${index} of ${length}.` },
    {
      scope: "following",
      label: "This and following events",
      description: following === 1
        ? `Event ${index}, the last of ${length}.`
        : `Events ${index} to ${length}: ${following} events.`,
    },
    { scope: "all", label: "All events", description: `All ${length} events in the series.` },
  ];
}

/**
 * Asked before editing or deleting an event in a series: this event, this and following, or all
 * events. Each answer says how many events it reaches. Choosing one runs the action (`onChoose`).
 */
export function ScopeDialog({
  event,
  action,
  open,
  onOpenChange,
  onChoose,
  pending = false,
  error,
}: {
  event: CalendarEvent;
  action: ScopeAction;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (scope: EditScope) => void;
  pending?: boolean;
  error?: string;
}) {
  const deleting = action === "delete";
  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
      size="sm"
      placement="center"
      title={deleting ? "Delete which events?" : "Change which events?"}
      description={`“${event.title}” repeats: it is event ${event.seriesIndex} of ${event.seriesLength}.`}
      footer={(
        <Button variant="ghost" size={{ base: "md", sm: "sm" }} onClick={() => onOpenChange(false)} disabled={pending} width={{ base: "full", sm: "auto" }}>
          Cancel
        </Button>
      )}
    >
      <Stack gap="2" role="group" aria-label={deleting ? "Which events to delete" : "Which events to change"}>
        {scopeChoices(event).map((choice) => (
          <Button
            key={choice.scope}
            variant="outline"
            colorPalette={deleting ? "danger" : undefined}
            h="auto"
            py="2.5"
            px="3"
            justifyContent="flex-start"
            textAlign="start"
            whiteSpace="normal"
            disabled={pending}
            onClick={() => onChoose(choice.scope)}
          >
            <Stack gap="0">
              <Text as="span" textStyle="bodySm" fontWeight="medium">{choice.label}</Text>
              <Text as="span" textStyle="caption" fontWeight="normal">{choice.description}</Text>
            </Stack>
          </Button>
        ))}
        {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
      </Stack>
    </AppDialog>
  );
}
