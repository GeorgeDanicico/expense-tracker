"use client";

import { Button, Center, Heading, Input, Stack, Text } from "@chakra-ui/react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";

import { Brand } from "@/components/layout/brand";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ApiError, apiRequest } from "@/lib/api/client";
import { afterPasswordChange } from "@/lib/api/invalidate";
import { ACCOUNT_PASSWORD_API_URL } from "@/lib/api/keys";

/**
 * Where the `(app)` layout sends an account that must choose a new password (a kid account a parent
 * created or reset). Any signed-in user may use it; a signed-out one is sent to sign in on submit.
 */
export default function ChangePasswordPage() {
  useDocumentTitle("Choose a new password");
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const form = useApiForm();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.pending) return;
    const formData = new FormData(event.currentTarget);
    const password = String(formData.get("password") ?? "");

    void form.submit(async () => {
      if (password !== formData.get("confirmPassword")) {
        throw new ApiError("Check the highlighted details and try again.", 422, {
          confirmPassword: ["The passwords don't match."],
        });
      }

      try {
        await apiRequest<void>(ACCOUNT_PASSWORD_API_URL, { method: "POST", body: JSON.stringify({ password }) });
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          router.replace("/login");
          return;
        }
        throw caught;
      }

      await afterPasswordChange(mutate);
      router.replace("/dashboard");
    }, { fallback: "Unable to change your password. Please try again." });
  }

  return (
    <Center minH="100dvh" px={{ base: "4", md: "6" }} py={{ base: "6", md: "10" }} bg="bg.canvas">
      <Card width="full" maxW="360px">
        <Card.Body p={{ base: "5", md: "6" }}>
          <Stack gap="5">
            <Brand />
            <Stack gap="1">
              <Heading as="h1" size="xl">
                Choose a new password
              </Heading>
              <Text textStyle="sm" color="fg.muted">
                Pick a password only you know. You&apos;ll use it to sign in from now on.
              </Text>
            </Stack>
            <form onSubmit={submit}>
              <Stack gap="3">
                <FormField
                  label="New password"
                  error={form.fieldError("password")}
                  hint="Use at least 8 characters."
                >
                  <Input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    size="md"
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </FormField>

                <FormField label="Confirm new password" error={form.fieldError("confirmPassword")}>
                  <Input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Type it again"
                    size="md"
                    minLength={8}
                    maxLength={128}
                    required
                  />
                </FormField>

                {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}

                <Button
                  type="submit"
                  variant="solid"
                  colorPalette="brand"
                  size="md"
                  width="full"
                  mt="1"
                  loading={form.pending}
                >
                  Save new password
                </Button>
              </Stack>
            </form>
          </Stack>
        </Card.Body>
      </Card>
    </Center>
  );
}
