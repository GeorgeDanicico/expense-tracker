"use client";

import { Button, NativeSelect, Stack } from "@chakra-ui/react";
import { Save } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FormField } from "@/components/ui/form-field";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import type { AccountData } from "@/lib/account/types";
import { changeCurrency } from "@/lib/api/account-requests";
import { CURRENCY_OPTIONS } from "@/lib/utils/currency";

/**
 * Settings → Account's display currency. Past expenses have no currency of their own, so while any
 * exist a change asks first, with the server's count: "Your 214 past expenses will be shown as USD;
 * amounts aren't converted." (audit B10). Nothing is converted or migrated.
 */
export function CurrencyCard({ currency: saved, onSaved }: { currency: string; onSaved: (account: AccountData) => Promise<unknown> }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const form = useApiForm();
  const currency = selected ?? saved;

  function save(confirmRelabel: boolean) {
    setDone(false);
    void form.submit(async () => {
      const result = await changeCurrency(currency, { confirmRelabel });
      if ("confirm" in result) {
        setWarning(result.confirm);
        return;
      }
      await onSaved(result.saved);
      setWarning(null);
      setSelected(null);
      setDone(true);
    }, { fallback: "The currency could not be saved. Please try again." });
  }

  return (
    <Card>
      <Card.Header title="Display currency" description="Used across your dashboard, expense list, and exports." />
      <form
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          save(false);
        }}
      >
        <Card.Body>
          <Stack gap="3">
            {done ? <InlineAlert status="success">Your account currency was updated.</InlineAlert> : null}
            {form.error && !warning ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
            <FormField label="Account currency" orientation={{ base: "vertical", md: "horizontal" }} css={{ "--field-label-width": "sizes.40" }}>
              <NativeSelect.Root maxW={{ md: "20rem" }}>
                <NativeSelect.Field
                  name="currency"
                  value={currency}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setDone(false);
                  }}
                >
                  {CURRENCY_OPTIONS.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.label} ({option.code})
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </FormField>
            <InlineAlert status="neutral">Changing currency updates the label only. Existing amounts are not converted.</InlineAlert>
          </Stack>
        </Card.Body>
        <Card.Footer justifyContent="flex-end" borderTopWidth="1px" pt="3">
          <Button type="submit" variant="solid" colorPalette="brand" loading={form.pending && !warning}>
            <Save size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Save changes
          </Button>
        </Card.Footer>
      </form>
      <ConfirmDialog
        open={warning !== null}
        onOpenChange={(open) => {
          if (!open) setWarning(null);
        }}
        title={`Show your expenses in ${currency}?`}
        confirmLabel={`Change to ${currency}`}
        cancelLabel={`Keep ${saved}`}
        pending={form.pending}
        error={warning ? form.error || undefined : undefined}
        onConfirm={() => save(true)}
      >
        {warning ? <InlineAlert status="warning">{warning}</InlineAlert> : null}
      </ConfirmDialog>
    </Card>
  );
}
