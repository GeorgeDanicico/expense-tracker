"use client";

import {
  Alert,
  Button,
  Field,
  Flex,
  Heading,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { Landmark } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";

import { ApiError, apiRequest } from "@/lib/api/client";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/types";

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
        await mutate(ACCOUNT_API_KEY);
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
      <Stack gap="4.5">
        <Field.Root invalid={Boolean(state.fieldErrors?.email)}>
          <Field.Label>Email address</Field.Label>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            size="lg"
            borderRadius="xl"
            required
          />
          <Field.ErrorText>{state.fieldErrors?.email?.[0]}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={Boolean(state.fieldErrors?.password)}>
          <Field.Label>Password</Field.Label>
          <Input
            name="password"
            type="password"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            placeholder="At least 8 characters"
            size="lg"
            borderRadius="xl"
            minLength={8}
            required
          />
          {mode === "signup" ? (
            <Field.HelperText>Use at least 8 characters.</Field.HelperText>
          ) : null}
          <Field.ErrorText>{state.fieldErrors?.password?.[0]}</Field.ErrorText>
        </Field.Root>

        {state.message ? (
          <Alert.Root
            status={state.status === "error" ? "error" : "success"}
            borderRadius="xl"
            variant="surface"
          >
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{state.message}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        <Button
          type="submit"
          colorPalette="purple"
          size="lg"
          width="full"
          borderRadius="xl"
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
    <Surface width="full" maxW="420px" p={{ base: "5", md: "6" }}>
      <Stack gap="5">
        <Flex align="center" gap="2">
          <Landmark size={20} color="#A64B32" aria-hidden="true" />
          <Text fontWeight="600">Simple Ledger</Text>
        </Flex>
        <Heading as="h1">
          {mode === "login" ? "Sign in" : "Create account"}
        </Heading>
        <Flex gap="2" role="group" aria-label="Authentication mode">
          <Button
            flex="1"
            variant="ghost"
            aria-pressed={mode === "login"}
            bg={mode === "login" ? "selected" : "transparent"}
            color={mode === "login" ? "accent" : "muted"}
            onClick={() => setMode("login")}
          >
            Sign in
          </Button>
          <Button
            flex="1"
            variant="ghost"
            aria-pressed={mode === "signup"}
            bg={mode === "signup" ? "selected" : "transparent"}
            color={mode === "signup" ? "accent" : "muted"}
            onClick={() => setMode("signup")}
          >
            Create account
          </Button>
        </Flex>
        <AuthModeForm key={mode} mode={mode} />
      </Stack>
    </Surface>
  );
}
