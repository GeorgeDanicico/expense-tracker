"use client";

import { Button, Heading, Input, Separator, Stack } from "@chakra-ui/react";
import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSWRConfig } from "swr";

import { Brand } from "@/components/layout/brand";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterSignIn } from "@/lib/api/invalidate";

type AuthMode = "login" | "signup";

function AuthModeForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [notice, setNotice] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form.pending) return;
    setNotice("");
    const formData = new FormData(event.currentTarget);

    void form.submit(async () => {
      const result = await apiRequest<{
        authenticated: boolean;
        message?: string;
      }>("/api/auth", {
        method: "POST",
        body: JSON.stringify({
          mode,
          email: formData.get("email"),
          password: formData.get("password"),
        }),
      });

      if (result.authenticated) {
        await afterSignIn(mutate);
        router.replace("/dashboard");
        return;
      }

      setNotice(result.message || "Check your inbox to continue.");
    }, { fallback: "Unable to continue. Please try again." });
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="3">
        <FormField label="Email address" error={form.fieldError("email")}>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            size="md"
            required
          />
        </FormField>

        <FormField
          label="Password"
          error={form.fieldError("password")}
          hint={mode === "signup" ? "Use at least 8 characters." : undefined}
        >
          <Input
            name="password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            placeholder="At least 8 characters"
            size="md"
            minLength={8}
            required
          />
        </FormField>

        {form.error || notice ? (
          <InlineAlert status={form.error ? "error" : "success"}>
            {form.error || notice}
          </InlineAlert>
        ) : null}

        <Button
          type="submit"
          variant="solid"
          colorPalette="brand"
          size="md"
          width="full"
          mt="1"
          loading={form.pending}
        >
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </Stack>
    </form>
  );
}

const CALLBACK_ERRORS: Record<string, string> = {
  "oauth-failed": "Google sign-in failed. Please try again.",
  "confirmation-failed": "We couldn't sign you in from that link. Please try again.",
};

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>("login");
  const callbackError = CALLBACK_ERRORS[useSearchParams().get("message") ?? ""];
  return (
    <Card width="full" maxW="360px">
      <Card.Body p={{ base: "5", md: "6" }}>
        <Stack gap="5">
          <Brand />
          <Heading as="h1" size="xl">
            {mode === "login" ? "Sign in" : "Create account"}
          </Heading>
          <SegmentedControl<AuthMode>
            aria-label="Authentication mode"
            name="auth-mode"
            fullWidth
            value={mode}
            onValueChange={setMode}
            items={[
              { value: "login", label: "Sign in" },
              { value: "signup", label: "Create account" },
            ]}
          />
          {callbackError ? (
            <InlineAlert status="error">{callbackError}</InlineAlert>
          ) : null}
          <Button asChild variant="outline" size="md" width="full">
            <a href="/api/auth/google">Continue with Google</a>
          </Button>
          <Separator />
          <AuthModeForm key={mode} mode={mode} />
        </Stack>
      </Card.Body>
    </Card>
  );
}
