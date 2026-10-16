"use client";

import { Button, Input, Stack, Text } from "@chakra-ui/react";
import { KeyRound } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useSWRConfig } from "swr";

import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterFamilyJoined } from "@/lib/api/invalidate";
import { FAMILY_JOIN_API_URL, FAMILY_JOIN_PREVIEW_API_URL, type FamilyResponse } from "@/lib/api/keys";
import type { InvitePreview } from "@/lib/family/repository";

/** The confirmation text for a previewed invite: who invited you, to which family, as what. */
export function joinSummary(preview: Pick<InvitePreview, "familyName" | "inviterName" | "role">) {
  const who = preview.inviterName ?? "A parent";
  return `${who} invited you to join ${preview.familyName} as a ${preview.role}.`;
}

/**
 * "Join with a code": checks the code first, then asks you to confirm before joining.
 * `initialCode` fills the field (used by the `/join/[code]` link).
 */
export function JoinFamilyForm({ initialCode = "" }: { initialCode?: string }) {
  const { mutate } = useSWRConfig();
  const previewForm = useApiForm();
  const joinForm = useApiForm();
  const [code, setCode] = useState(initialCode);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const codeError = previewForm.fieldError("code");

  function check(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (previewForm.pending) return;

    void previewForm.submit(async () => {
      const found = await apiRequest<InvitePreview>(FAMILY_JOIN_PREVIEW_API_URL, {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      joinForm.reset();
      setPreview(found);
    }, { fallback: "Unable to check the code. Please try again." });
  }

  function join() {
    void joinForm.submit(async () => {
      const joined = await apiRequest<FamilyResponse>(FAMILY_JOIN_API_URL, { method: "POST", body: JSON.stringify({ code }) });
      setPreview(null);
      await afterFamilyJoined(mutate, joined);
    }, { fallback: "Unable to join the family. Please try again." });
  }

  return (
    <Card>
      <Card.Header title="Join with a code" description="Got an invite code from a parent? Enter it here." />
      <form onSubmit={check}>
        <Card.Body>
          <Stack gap="3">
            {previewForm.error && !codeError ? <InlineAlert status="error">{previewForm.error}</InlineAlert> : null}
            <FormField label="Invite code" error={codeError}>
              <Input
                name="code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="ABCD2345"
                maxLength={20}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                textTransform="uppercase"
                required
              />
            </FormField>
          </Stack>
        </Card.Body>
        <Card.Footer justifyContent="flex-end" borderTopWidth="1px" pt="3">
          <Button type="submit" variant="solid" colorPalette="brand" loading={previewForm.pending}>
            <KeyRound size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Continue
          </Button>
        </Card.Footer>
      </form>

      <ConfirmDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open && !joinForm.pending) setPreview(null);
        }}
        title="Join this family?"
        description={preview ? joinSummary(preview) : undefined}
        confirmLabel="Join family"
        tone="brand"
        pending={joinForm.pending}
        error={joinForm.error}
        onConfirm={join}
      >
        <Text textStyle="bodySm" color="fg.muted">
          Parents in this family will see your expenses, investments and net worth.
        </Text>
      </ConfirmDialog>
    </Card>
  );
}
