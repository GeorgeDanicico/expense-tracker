"use client";

import { Box, Button, Stack } from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { ICON } from "@/components/ui/icon";
import { transition } from "@/components/ui/theme/motion";

/**
 * Shows or hides its content by collapsing it to nothing: a deleted row collapsing out (and back on
 * undo), the content of a `Disclosure`. Grid rows go from `1fr` to `0fr`, so nothing is measured;
 * the one animated size in the app. `entering` slides a new row in from above.
 */
export function Collapse({
  open,
  entering = false,
  id,
  children,
}: {
  open: boolean;
  entering?: boolean;
  id?: string;
  children: ReactNode;
}) {
  return (
    <Box
      id={id}
      display="grid"
      gridTemplateRows={open ? "1fr" : "0fr"}
      opacity={open ? 1 : 0}
      transition={transition("grid-template-rows, opacity", "moderate")}
      animationName={entering ? "slide-from-top, fade-in" : undefined}
      animationDuration="slow"
      animationTimingFunction="enter"
      animationFillMode="both"
      aria-hidden={!open}
      inert={!open}
    >
      <Box overflow="hidden" minH="0">
        {children}
      </Box>
    </Box>
  );
}

/**
 * Folded-away content behind a quiet toggle ("More details", "Done · 3"): progressive disclosure for
 * what most entries don't need.
 */
export function Disclosure({ label, defaultOpen = false, children }: { label: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <Stack gap="0">
      <Button variant="ghost" size="sm" alignSelf="flex-start" color="fg.muted" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {label}
        <Box as="span" display="inline-flex" rotate={open ? "180deg" : "0deg"} transition={transition("rotate", "moderate")}>
          <ChevronDown size={ICON.sm} aria-hidden="true" />
        </Box>
      </Button>
      <Collapse open={open} id={id}>
        <Stack gap="3" pt="2">
          {children}
        </Stack>
      </Collapse>
    </Stack>
  );
}
