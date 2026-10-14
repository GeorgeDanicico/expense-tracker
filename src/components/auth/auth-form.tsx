"use client";

import { Button, Heading, Input, Stack } from "@chakra-ui/react";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";

import { Brand } from "@/components/layout/brand";
import { Card } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ApiError, apiRequest } from "@/lib/api/client";
import { afterSignIn } from "@/lib/api/invalidate";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/forms";

type AuthMode = "login" | "signup";

function AuthModeForm({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [state, setState] = useState<ActionState>(INITIAL_ACTION_STATE);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setState(INITIAL_ACTION_STATE);
    const formData = new FormData(event.currentTarget);

    try {
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

      setState({
        status: "success",
        message: result.message || "Check your inbox to continue.",
      });
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to continue. Please try again.",
        fieldErrors: error instanceof ApiError ? error.fieldErrors : undefined,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="3">
        <FormField label="Email address" error={state.fieldErrors?.email?.[0]}>
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
          error={state.fieldErrors?.password?.[0]}
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

        {state.message ? (
          <InlineAlert status={state.status === "error" ? "error" : "success"}>
            {state.message}
          </InlineAlert>
        ) : null}

        <Button
          type="submit"
          variant="solid"
          colorPalette="brand"
          size="md"
          width="full"
          mt="1"
          loading={pending}
        >
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </Stack>
    </form>
  );
}

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>("login");
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
          <AuthModeForm key={mode} mode={mode} />
        </Stack>
      </Card.Body>
    </Card>
  );
}
