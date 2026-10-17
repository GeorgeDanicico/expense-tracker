"use client";

import { Button, chakra, Flex, Text } from "@chakra-ui/react";
import { useState } from "react";
import { useSWRConfig } from "swr";

import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterFamilyChanged } from "@/lib/api/invalidate";
import { familyMemberColorApiUrl, type FamilyResponse } from "@/lib/api/keys";
import { MEMBER_COLOR_COUNT, MEMBER_COLOR_NAMES } from "@/lib/family/member-colors";
import type { FamilyMember } from "@/lib/family/repository";

const SLOTS = Array.from({ length: MEMBER_COLOR_COUNT }, (_, index) => index + 1);

/**
 * Choose one member's colour. Colours another member already has are disabled; "Automatic" hands the
 * choice back to the app. Saving calls `PATCH /api/family/members/[id]/color`.
 */
export function EditColorDialog({
  member,
  members,
  open,
  onOpenChange,
}: {
  member: FamilyMember;
  members: readonly FamilyMember[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [color, setColor] = useState<number | null>(member.color);
  const name = member.displayName ?? member.username ?? "this member";
  const formId = `edit-color-${member.memberId}`;
  const takenByOthers = new Set(
    members.filter((other) => other.memberId !== member.memberId && other.color !== null).map((other) => other.color),
  );

  function save() {
    void form.submit(async () => {
      const updated = await apiRequest<FamilyResponse>(familyMemberColorApiUrl(member.memberId), {
        method: "PATCH",
        body: JSON.stringify({ color }),
      });
      await afterFamilyChanged(mutate, updated);
      onOpenChange(false);
    }, { fallback: "Unable to save the colour. Please try again." });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!form.pending) onOpenChange(next);
      }}
      title={`Colour for ${name}`}
      description="Shown beside their name and on their expenses. Automatic picks the first colour nobody has chosen."
      footer={<FormActions submitLabel="Save colour" form={formId} closesDialog pending={form.pending} />}
    >
      <form
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
        <Flex role="radiogroup" aria-label={`Colour for ${name}`} wrap="wrap" gap="2" align="center">
          <Button
            type="button"
            size="xs"
            variant={color === null ? "solid" : "outline"}
            role="radio"
            aria-checked={color === null}
            disabled={form.pending}
            onClick={() => setColor(null)}
          >
            Automatic
          </Button>
          {SLOTS.map((slot) => {
            const colorName = MEMBER_COLOR_NAMES[slot - 1];
            const taken = takenByOthers.has(slot);
            const selected = color === slot;
            return (
              <chakra.button
                key={slot}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={taken ? `${colorName}, taken by another member` : colorName}
                title={colorName}
                disabled={taken || form.pending}
                onClick={() => setColor(slot)}
                boxSize="8"
                borderRadius="full"
                bg={`member.${slot}`}
                borderWidth="2px"
                borderColor={selected ? "fg" : "transparent"}
                outlineOffset="2px"
                opacity={taken ? 0.3 : 1}
                cursor={taken ? "not-allowed" : "pointer"}
              />
            );
          })}
        </Flex>
        <Text textStyle="caption" mt="3">
          Selected: {color === null ? "Automatic" : MEMBER_COLOR_NAMES[color - 1]}
        </Text>
      </form>
    </AppDialog>
  );
}
