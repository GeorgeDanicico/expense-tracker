"use client";

import { Input, List, Text } from "@chakra-ui/react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useFamilyWrites } from "@/components/family/use-family-writes";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";

/** The creator types the family's name to delete it. Calls `DELETE /api/family { confirmName }`. */
export function DeleteFamilyDialog({
  familyName,
  open,
  onOpenChange,
}: {
  familyName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const writes = useFamilyWrites();
  const form = useApiForm();
  const [typed, setTyped] = useState("");
  const formId = "delete-family";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typed.trim() !== familyName) return;

    void form.submit(async () => {
      await writes.deleteFamily(typed.trim());
      onOpenChange(false);
      router.replace("/settings/family");
    }, { fallback: "Unable to delete the family. Please try again." });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!form.pending) onOpenChange(next);
      }}
      title={`Delete ${familyName}?`}
      description="This can't be undone."
      footer={
        <FormActions
          submitLabel="Delete family"
          form={formId}
          closesDialog
          tone="danger"
          pending={form.pending}
          disabled={typed.trim() !== familyName}
        />
      }
    >
      <form id={formId} onSubmit={submit}>
        {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
        <Text textStyle="bodySm" mb="2">
          This deletes the family, all its members and its invites, and later its to-dos, calendar and so on.
        </Text>
        <List.Root ps="5" mb="4" textStyle="bodySm" color="fg.muted">
          <List.Item>Everyone keeps their account.</List.Item>
          <List.Item>Everyone&apos;s own expenses, investments and net worth are not deleted.</List.Item>
        </List.Root>
        <FormField
          label={`Type ${familyName} to confirm`}
          error={form.fieldError("confirmName")}
        >
          <Input
            name="confirmName"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={form.pending}
          />
        </FormField>
      </form>
    </AppDialog>
  );
}
