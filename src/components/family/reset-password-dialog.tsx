"use client";

import { Input } from "@chakra-ui/react";
import { useState, type FormEvent } from "react";

import { useFamilyWrites } from "@/components/family/use-family-writes";
import { KidSignInDetails } from "@/components/family/kid-sign-in-details";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import type { FamilyMemberView } from "@/lib/family/views";

/** Give a kid a new temporary password. Calls `POST /api/family/members/[id]/password`. */
export function ResetPasswordDialog({
  member,
  open,
  onOpenChange,
}: {
  member: FamilyMemberView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const writes = useFamilyWrites();
  const form = useApiForm();
  const [done, setDone] = useState<string | null>(null);
  const name = member.displayName ?? member.username ?? "this kid";
  const formId = `reset-password-${member.memberId}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password") ?? "");

    void form.submit(async () => {
      await writes.resetKidPassword(member.memberId, password);
      setDone(password);
    }, { fallback: "Unable to reset the password. Please try again." });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!form.pending) onOpenChange(next);
      }}
      title={done ? "Password reset" : `Reset password for ${name}`}
      description={done ? undefined : "Set a temporary password. They'll choose a new one the next time they sign in."}
      footer={
        done ? (
          <FormActions submitLabel="Done" onSubmit={() => onOpenChange(false)} />
        ) : (
          <FormActions submitLabel="Reset password" form={formId} closesDialog pending={form.pending} />
        )
      }
    >
      {done ? (
        <KidSignInDetails name={name} password={done} />
      ) : (
        <form id={formId} onSubmit={submit}>
          {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
          <FormField
            label="Temporary password"
            error={form.fieldError("password")}
            hint="At least 8 characters."
          >
            <Input
              name="password"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              minLength={8}
              maxLength={128}
              required
              disabled={form.pending}
            />
          </FormField>
        </form>
      )}
    </AppDialog>
  );
}
