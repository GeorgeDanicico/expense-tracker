"use client";

import { Button, Center, Heading, Input, Stack, Text } from "@chakra-ui/react";
import type { FormEvent } from "react";

import { Brand } from "@/components/layout/brand";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useAccount } from "@/hooks/use-account";
import { useApiForm } from "@/hooks/use-api-form";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { changePassword } from "@/lib/api/account-requests";
import { ApiError } from "@/lib/api/client";
import { loadAfterSessionChange } from "@/lib/api/auth-redirect";

/**
 * Where the `(app)` layout sends an account that must choose a new password (a kid account a parent
 * created or reset), and where any other API call sends it too (403 `password_change_required`). Any
 * signed-in user may use it; a signed-out one is sent to sign in on submit.
 *
 * It asks for the current password first, as every password change does (audit P5). For a kid who
 * must change theirs, that is the temporary password a parent gave them and they just signed in with,
 * so the field says so. A kid who doesn't know it can sign out from here.
 */
export default function ChangePasswordPage() {
  useDocumentTitle("Choose a new password");
  const { account } = useAccount();
  const form = useApiForm();
  const temporary = account?.mustChangePassword === true;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.pending) return;
    const formData = new FormData(event.currentTarget);
    const change = {
      currentPassword: String(formData.get("currentPassword") ?? ""),
      password: String(formData.get("password") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
    };

    void form.submit(async () => {
      try {
        await changePassword(change);
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          loadAfterSessionChange("/login");
          return;
        }
        throw caught;
      }

      loadAfterSessionChange("/dashboard");
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
                  label={temporary ? "Temporary password" : "Current password"}
                  error={form.fieldError("currentPassword")}
                  hint={temporary ? "The password you were given and just signed in with." : "The password you sign in with today."}
                >
                  <Input
                    name="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    size="md"
                    maxLength={128}
                    required
                  />
                </FormField>

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
            {temporary ? (
              <Stack gap="1" borderTopWidth="1px" pt="3">
                <Text textStyle="sm" color="fg.muted">
                  Don&apos;t know the temporary password? Ask the parent who set it, or sign out.
                </Text>
                <SignOutButton />
              </Stack>
            ) : null}
          </Stack>
        </Card.Body>
      </Card>
    </Center>
  );
}
