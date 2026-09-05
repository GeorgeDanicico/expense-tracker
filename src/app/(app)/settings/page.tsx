"use client";

import {
  Alert,
  Box,
  Button,
  Field,
  Flex,
  Heading,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react";
import { BadgeDollarSign, Info, Save } from "lucide-react";
import { FormEvent, useState } from "react";
import useSWR from "swr";

import { DataError, DataLoading } from "@/components/ui/data-state";
import { Surface } from "@/components/ui/surface";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { apiRequest } from "@/lib/api/client";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import type { AccountData } from "@/lib/types";
import { CURRENCY_OPTIONS } from "@/lib/utils/currency";

export default function SettingsPage() {
  useDocumentTitle("Settings");
  const { data, error, isLoading, mutate } = useSWR<AccountData>(ACCOUNT_API_KEY);
  const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("");

  async function saveCurrency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("saving");
    setMessage("");

    try {
      const updated = await apiRequest<AccountData>(ACCOUNT_API_KEY, {
        method: "PATCH",
        body: JSON.stringify({ currency: selectedCurrency ?? data?.currency }),
      });
      await mutate(updated, { revalidate: false });
      setStatus("saved");
    } catch (caught) {
      setStatus("error");
      setMessage(caught instanceof Error ? caught.message : "The currency could not be saved.");
    }
  }

  if (isLoading && !data) return <DataLoading label="Loading your settings…" />;
  if (error && !data) return <DataError retry={() => void mutate()} />;
  if (!data) return <DataLoading label="Loading your settings…" />;
  const currency = selectedCurrency ?? data.currency;

  return (
    <Stack maxW="780px" gap={{ base: "6", md: "7" }}>
      <Stack gap="1">
        <Text color="purple.600" fontSize="sm" fontWeight="750">PREFERENCES</Text>
        <Heading as="h1" size={{ base: "2xl", md: "3xl" }} color="gray.900" letterSpacing="-0.045em">
          Settings
        </Heading>
        <Text color="gray.500">Personalize how your ledger displays financial information.</Text>
      </Stack>

      {status === "saved" ? (
        <Alert.Root status="success" borderRadius="2xl" variant="surface">
          <Alert.Indicator />
          <Alert.Description>Your account currency was updated.</Alert.Description>
        </Alert.Root>
      ) : null}

      {status === "error" ? (
        <Alert.Root status="error" borderRadius="2xl" variant="surface">
          <Alert.Indicator />
          <Alert.Description>{message}</Alert.Description>
        </Alert.Root>
      ) : null}

      <Surface overflow="hidden">
        <Flex
          align={{ base: "flex-start", sm: "center" }}
          gap="4"
          p={{ base: "5", md: "6" }}
          bg="linear-gradient(120deg, #faf5ff 0%, #ffffff 68%)"
          borderBottomWidth="1px"
          borderColor="gray.100"
        >
          <Flex width="12" height="12" flexShrink="0" align="center" justify="center" borderRadius="2xl" color="purple.700" bg="purple.100">
            <BadgeDollarSign size={23} aria-hidden="true" />
          </Flex>
          <Stack gap="1">
            <Heading as="h2" size="lg" letterSpacing="-0.025em">Display currency</Heading>
            <Text color="gray.500" fontSize="sm">Used across your dashboard, expense list, and exports.</Text>
          </Stack>
        </Flex>

        <Box p={{ base: "5", md: "6" }}>
          <form onSubmit={saveCurrency}>
            <Stack gap="5" align="start">
              <Field.Root maxW="390px">
                <Field.Label>Account currency</Field.Label>
                <NativeSelect.Root size="lg">
                  <NativeSelect.Field
                    name="currency"
                    value={currency}
                    onChange={(event) => {
                      setSelectedCurrency(event.target.value);
                      setStatus("idle");
                    }}
                    borderRadius="xl"
                  >
                    {CURRENCY_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label} ({option.code})
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
              </Field.Root>

              <Flex maxW="35rem" align="flex-start" gap="2.5" p="3.5" borderRadius="xl" color="gray.600" bg="blue.50" fontSize="sm">
                <Box mt="0.5" color="blue.600"><Info size={16} aria-hidden="true" /></Box>
                Changing currency updates the label only. Existing amounts are not converted.
              </Flex>

              <Button type="submit" colorPalette="purple" borderRadius="xl" loading={status === "saving"}>
                <Save size={17} aria-hidden="true" /> Save changes
              </Button>
            </Stack>
          </form>
        </Box>
      </Surface>
    </Stack>
  );
}
