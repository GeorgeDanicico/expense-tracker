import {
  Alert,
  Box,
  Button,
  Field,
  Heading,
  NativeSelect,
  Stack,
  Text,
} from "@chakra-ui/react";
import type { Metadata } from "next";

import { updateCurrencyAction } from "@/app/(app)/settings/actions";
import { getAccountCurrency } from "@/lib/data/account";
import { CURRENCY_OPTIONS } from "@/lib/utils/currency";

export const metadata: Metadata = { title: "Settings" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const [currency, params] = await Promise.all([
    getAccountCurrency(),
    searchParams,
  ]);
  const status = first(params.status);

  return (
    <Stack gap="8" maxW="680px">
      <Stack gap="1">
        <Text color="gray.500" fontSize="sm">Account preferences</Text>
        <Heading as="h1" size="2xl">Settings</Heading>
      </Stack>

      <Box bg="white" borderWidth="1px" borderColor="gray.200" p={{ base: "5", md: "6" }}>
        <Stack gap="5">
          <Stack gap="1">
            <Heading as="h2" size="lg">Currency</Heading>
            <Text color="gray.600" fontSize="sm">
              This currency is used across your dashboard, expenses, and Excel exports.
            </Text>
          </Stack>

          {status === "saved" ? (
            <Alert.Root status="success">
              <Alert.Indicator />
              <Alert.Description>Your account currency was updated.</Alert.Description>
            </Alert.Root>
          ) : null}

          {status === "invalid" || status === "error" ? (
            <Alert.Root status="error">
              <Alert.Indicator />
              <Alert.Description>
                {status === "invalid"
                  ? "Choose a supported currency."
                  : "The currency could not be saved. Please try again."}
              </Alert.Description>
            </Alert.Root>
          ) : null}

          <form action={updateCurrencyAction}>
            <Stack gap="4" align="start">
              <Field.Root maxW="360px">
                <Field.Label>Account currency</Field.Label>
                <NativeSelect.Root>
                  <NativeSelect.Field name="currency" defaultValue={currency}>
                    {CURRENCY_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.label} ({option.code})
                      </option>
                    ))}
                  </NativeSelect.Field>
                  <NativeSelect.Indicator />
                </NativeSelect.Root>
                <Field.HelperText>
                  Changing currency relabels existing amounts; it does not convert their values.
                </Field.HelperText>
              </Field.Root>
              <Button type="submit" colorPalette="blue">Save currency</Button>
            </Stack>
          </form>
        </Stack>
      </Box>
    </Stack>
  );
}
