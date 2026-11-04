"use client";

import { Button, Input, Stack } from "@chakra-ui/react";
import { Users } from "lucide-react";
import type { FormEvent } from "react";

import { useFamilyWrites } from "@/components/family/use-family-writes";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";

/** "Create a family": a name field. You become the family's first parent. */
export function CreateFamilyForm() {
  const writes = useFamilyWrites();
  const form = useApiForm();
  const nameError = form.fieldError("name");

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.pending) return;
    const name = String(new FormData(event.currentTarget).get("name") ?? "");

    void form.submit(async () => {
      await writes.createFamily(name);
    }, { fallback: "Unable to create the family. Please try again." });
  }

  return (
    <Card>
      <Card.Header
        title="Create a family"
        description="Start a family and invite the people you share money with. You'll be its first parent."
      />
      <form onSubmit={create}>
        <Card.Body>
          <Stack gap="3">
            {form.error && !nameError ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
            <FormField label="Family name" error={nameError}>
              <Input name="name" placeholder="The Popescu family" maxLength={60} autoComplete="off" required />
            </FormField>
          </Stack>
        </Card.Body>
        <Card.Footer justifyContent="flex-end" borderTopWidth="1px" pt="3">
          <Button type="submit" variant="solid" colorPalette="brand" loading={form.pending}>
            <Users size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Create family
          </Button>
        </Card.Footer>
      </form>
    </Card>
  );
}
