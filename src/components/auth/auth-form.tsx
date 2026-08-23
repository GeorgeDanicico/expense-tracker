"use client";

import {
  Alert,
  Box,
  Button,
  Field,
  Heading,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useActionState, useState } from "react";

import { loginAction, signupAction } from "@/app/(auth)/login/actions";
import { INITIAL_ACTION_STATE } from "@/lib/types";

type AuthMode = "login" | "signup";

function AuthModeForm({ mode }: { mode: AuthMode }) {
  const action = mode === "login" ? loginAction : signupAction;
  const [state, formAction, pending] = useActionState(action, INITIAL_ACTION_STATE);

  return (
    <form action={formAction}>
      <Stack gap="4">
        <Field.Root invalid={Boolean(state.fieldErrors?.email)}>
          <Field.Label>Email</Field.Label>
          <Input name="email" type="email" autoComplete="email" required />
          <Field.ErrorText>{state.fieldErrors?.email?.[0]}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={Boolean(state.fieldErrors?.password)}>
          <Field.Label>Password</Field.Label>
          <Input
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
          <Field.HelperText>At least 8 characters.</Field.HelperText>
          <Field.ErrorText>{state.fieldErrors?.password?.[0]}</Field.ErrorText>
        </Field.Root>

        {state.message ? (
          <Alert.Root status={state.status === "error" ? "error" : "success"}>
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{state.message}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        <Button type="submit" colorPalette="blue" width="full" loading={pending}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </Stack>
    </form>
  );
}

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>("login");

  return (
    <Box as="section" width="full" maxW="420px" bg="white" borderWidth="1px" borderColor="gray.200" p={{ base: "6", md: "8" }}>
      <Stack gap="6">
        <Stack gap="2">
          <Text textStyle="sm" color="gray.500" fontWeight="semibold" letterSpacing="wide">
            SIMPLE LEDGER
          </Text>
          <Heading as="h1" size="2xl" color="gray.900">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </Heading>
          <Text color="gray.600">
            {mode === "login"
              ? "Sign in to review and record your expenses."
              : "Use an email and password to start your private ledger."}
          </Text>
        </Stack>

        <AuthModeForm key={mode} mode={mode} />

        <Button
          variant="plain"
          colorPalette="blue"
          onClick={() => setMode((value) => (value === "login" ? "signup" : "login"))}
        >
          {mode === "login" ? "Need an account? Sign up" : "Already registered? Sign in"}
        </Button>
      </Stack>
    </Box>
  );
}
