"use client";

import {
  Alert,
  Button,
  Dialog,
  Field,
  Flex,
  Input,
  NativeSelect,
  Portal,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { FormEvent, useState } from "react";
import { useSWRConfig } from "swr";

import { ApiError, apiRequest } from "@/lib/api/client";
import { INVESTMENTS_API_KEY } from "@/lib/api/keys";
import {
  INVESTMENT_BROKER_IDS,
  INVESTMENT_BROKER_LABELS,
  type InvestmentTransactionMutationResponse,
} from "@/lib/investments/types";
import { CURRENCY_OPTIONS } from "@/lib/utils/currency";

const MOCK_INSTRUMENTS = new Set(["VWCE.DE", "AAPL.US", "TLV.BX"]);

function localDateTimeValue() {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

function formTimestamp(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value) return value;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
}

function InvestmentForm({ onSuccess }: { onSuccess: () => void }) {
  const { mutate } = useSWRConfig();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]> | undefined>();
  const [instrument, setInstrument] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setFieldErrors(undefined);

    const formData = new FormData(event.currentTarget);
    try {
      await apiRequest<InvestmentTransactionMutationResponse>("/api/investment-transactions", {
        method: "POST",
        body: JSON.stringify({
          brokerId: formData.get("brokerId"),
          instrument: formData.get("instrument"),
          currency: formData.get("currency"),
          side: "buy",
          amount: formData.get("amount"),
          quantity: formData.get("quantity"),
          unitPrice: formData.get("unitPrice"),
          executedAt: formTimestamp(formData.get("executedAt")),
        }),
      });
      await mutate(INVESTMENTS_API_KEY);
      onSuccess();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The investment could not be saved.");
      setFieldErrors(caught instanceof ApiError ? caught.fieldErrors : undefined);
    } finally {
      setPending(false);
    }
  }

  const instrumentCode = instrument.trim().toUpperCase();
  const instrumentHint = instrumentCode
    ? MOCK_INSTRUMENTS.has(instrumentCode)
      ? "A mock quote is available for this symbol."
      : "No mock quote is available yet, but this valid symbol can still be saved."
    : "Use a stable listing code such as VWCE.DE or AAPL.US.";

  function fieldError(name: string) {
    return fieldErrors?.[name]?.[0];
  }

  return (
    <form onSubmit={submit} aria-busy={pending}>
      <Stack gap="4.5">
        <Field.Root invalid={Boolean(fieldError("brokerId"))}>
          <Field.Label>Broker</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field name="brokerId" defaultValue={INVESTMENT_BROKER_IDS[0]} borderRadius="xl">
              {INVESTMENT_BROKER_IDS.map((brokerId) => (
                <option key={brokerId} value={brokerId}>{INVESTMENT_BROKER_LABELS[brokerId]}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Field.ErrorText>{fieldError("brokerId")}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={Boolean(fieldError("instrument"))}>
          <Field.Label>Instrument / listing symbol</Field.Label>
          <Input
            name="instrument"
            value={instrument}
            onChange={(event) => setInstrument(event.target.value)}
            maxLength={80}
            placeholder="e.g. VWCE.DE"
            autoFocus
            required
            borderRadius="xl"
          />
          <Field.HelperText>{instrumentHint}</Field.HelperText>
          <Field.ErrorText>{fieldError("instrument")}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={Boolean(fieldError("currency"))}>
          <Field.Label>Instrument currency</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field name="currency" defaultValue="EUR" borderRadius="xl">
              {CURRENCY_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>{option.code} · {option.label}</option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Field.HelperText>Amount and prices are recorded in this native currency.</Field.HelperText>
          <Field.ErrorText>{fieldError("currency")}</Field.ErrorText>
        </Field.Root>

        <Stack gap="3">
          <Text color="gray.500" fontSize="xs" fontWeight="750" letterSpacing="0.06em">FIRST BUY ORDER</Text>
          <Flex gap="4" direction={{ base: "column", sm: "row" }}>
            <Field.Root flex="1" invalid={Boolean(fieldError("quantity"))}>
              <Field.Label>Quantity</Field.Label>
              <Input name="quantity" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required borderRadius="xl" />
              <Field.ErrorText>{fieldError("quantity")}</Field.ErrorText>
            </Field.Root>
            <Field.Root flex="1" invalid={Boolean(fieldError("unitPrice"))}>
              <Field.Label>Unit price</Field.Label>
              <Input name="unitPrice" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required borderRadius="xl" />
              <Field.ErrorText>{fieldError("unitPrice")}</Field.ErrorText>
            </Field.Root>
          </Flex>

          <Field.Root invalid={Boolean(fieldError("amount"))}>
            <Field.Label>Order amount</Field.Label>
            <Input name="amount" type="number" inputMode="decimal" min="0.0000000001" step="any" placeholder="0.00" required borderRadius="xl" />
            <Field.HelperText>Total order value in the selected currency.</Field.HelperText>
            <Field.ErrorText>{fieldError("amount")}</Field.ErrorText>
          </Field.Root>

          <Field.Root invalid={Boolean(fieldError("executedAt"))}>
            <Field.Label>Execution date and time</Field.Label>
            <Input name="executedAt" type="datetime-local" defaultValue={localDateTimeValue()} required borderRadius="xl" />
            <Field.ErrorText>{fieldError("executedAt")}</Field.ErrorText>
          </Field.Root>
        </Stack>

        {error ? (
          <Alert.Root status="error" borderRadius="xl">
            <Alert.Indicator />
            <Alert.Description>{error}</Alert.Description>
          </Alert.Root>
        ) : null}

        <Text className="sr-only" role="status" aria-live="polite">
          {pending ? "Saving investment…" : ""}
        </Text>
        <Button type="submit" minH="11" colorPalette="purple" borderRadius="xl" loading={pending}>
          Save investment
        </Button>
      </Stack>
    </form>
  );
}

export function AddInvestmentDialog() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={(details) => setOpen(details.open)} size="md">
      <Dialog.Trigger asChild>
        <Button width={{ base: "full", sm: "auto" }} minH="11" colorPalette="purple" borderRadius="xl" boxShadow="0 8px 18px rgb(124 58 237 / 16%)">
          <Plus size={17} aria-hidden="true" /> Add investment
        </Button>
      </Dialog.Trigger>
      <Portal>
        <Dialog.Backdrop bg="blackAlpha.500" backdropFilter="blur(4px)" />
        <Dialog.Positioner alignItems={{ base: "flex-end", sm: "center" }} p={{ base: "0", sm: "4" }} pb={{ base: "env(safe-area-inset-bottom)", sm: "4" }}>
          <Dialog.Content
            maxH={{ base: "calc(100dvh - env(safe-area-inset-top) - 1rem)", sm: "90dvh" }}
            borderRadius={{ base: "2xl 2xl 0 0", sm: "3xl" }}
            boxShadow="2xl"
            overflowY="auto"
          >
            <Dialog.Header>
              <Stack gap="1">
                <Dialog.Title>Add an investment</Dialog.Title>
                <Dialog.Description color="gray.500" fontSize="sm">
                  The first recorded order creates the investment under its broker.
                </Dialog.Description>
              </Stack>
            </Dialog.Header>
            <Dialog.Body>
              {open ? <InvestmentForm onSuccess={() => setOpen(false)} /> : null}
            </Dialog.Body>
            <Dialog.CloseTrigger asChild>
              <Button variant="ghost" size="sm" borderRadius="lg" aria-label="Close dialog">
                <X size={17} aria-hidden="true" />
              </Button>
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
