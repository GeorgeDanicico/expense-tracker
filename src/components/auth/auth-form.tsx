"use client";

import {
  Alert,
  Button,
  Field,
  Flex,
  Heading,
  Input,
  SimpleGrid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { ChartNoAxesCombined, Landmark, LockKeyhole, Smartphone, Sparkles } from "lucide-react";
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
      const result = await apiRequest<{ authenticated: boolean; message?: string }>("/api/auth", {
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

      setState({ status: "success", message: result.message || "Check your inbox to continue." });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Unable to continue. Please try again.",
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
          <Input name="email" type="email" autoComplete="email" placeholder="you@example.com" size="lg" borderRadius="xl" required />
          <Field.ErrorText>{state.fieldErrors?.email?.[0]}</Field.ErrorText>
        </Field.Root>

        <Field.Root invalid={Boolean(state.fieldErrors?.password)}>
          <Field.Label>Password</Field.Label>
          <Input
            name="password"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder="At least 8 characters"
            size="lg"
            borderRadius="xl"
            minLength={8}
            required
          />
          {mode === "signup" ? <Field.HelperText>Use at least 8 characters.</Field.HelperText> : null}
          <Field.ErrorText>{state.fieldErrors?.password?.[0]}</Field.ErrorText>
        </Field.Root>

        {state.message ? (
          <Alert.Root status={state.status === "error" ? "error" : "success"} borderRadius="xl" variant="surface">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{state.message}</Alert.Description>
            </Alert.Content>
          </Alert.Root>
        ) : null}

        <Button type="submit" colorPalette="purple" size="lg" width="full" borderRadius="xl" loading={pending} boxShadow="0 10px 22px rgb(124 58 237 / 17%)">
          {mode === "login" ? "Sign in to your ledger" : "Create free account"}
        </Button>
      </Stack>
    </form>
  );
}

const benefits = [
  { icon: ChartNoAxesCombined, title: "See the whole picture", body: "Clear monthly trends and category insights." },
  { icon: Smartphone, title: "Made for every screen", body: "A fast, installable experience on desktop and mobile." },
  { icon: LockKeyhole, title: "Private by design", body: "Your ledger stays protected behind your account." },
];

export function AuthForm() {
  const [mode, setMode] = useState<AuthMode>("login");

  return (
    <SimpleGrid
      width="full"
      maxW="1040px"
      columns={{ base: 1, lg: 2 }}
      overflow="hidden"
      borderWidth="1px"
      borderColor="whiteAlpha.700"
      borderRadius={{ base: "3xl", lg: "32px" }}
      bg="white"
      boxShadow="0 30px 80px rgb(49 46 129 / 16%)"
    >
      <Flex
        display={{ base: "none", lg: "flex" }}
        position="relative"
        overflow="hidden"
        minH="660px"
        direction="column"
        justify="space-between"
        p="10"
        color="white"
        bg="linear-gradient(145deg, #312e81 0%, #5b21b6 58%, #7c3aed 100%)"
        _before={{
          content: '""',
          position: "absolute",
          width: "22rem",
          height: "22rem",
          top: "-11rem",
          right: "-10rem",
          borderRadius: "full",
          borderWidth: "1px",
          borderColor: "whiteAlpha.300",
        }}
        _after={{
          content: '""',
          position: "absolute",
          width: "18rem",
          height: "18rem",
          bottom: "-11rem",
          left: "-8rem",
          borderRadius: "full",
          bg: "whiteAlpha.100",
        }}
      >
        <Flex position="relative" zIndex="1" align="center" gap="3">
          <Flex width="11" height="11" align="center" justify="center" borderRadius="xl" bg="whiteAlpha.200" borderWidth="1px" borderColor="whiteAlpha.300">
            <Landmark size={22} aria-hidden="true" />
          </Flex>
          <Stack gap="0">
            <Text fontWeight="800" fontSize="lg">Simple Ledger</Text>
            <Text color="whiteAlpha.700" fontSize="xs">Money, made clear.</Text>
          </Stack>
        </Flex>

        <Stack position="relative" zIndex="1" gap="8">
          <Stack gap="3">
            <Flex width="fit-content" align="center" gap="2" px="3" py="1.5" borderRadius="full" color="purple.100" bg="whiteAlpha.100" fontSize="xs" fontWeight="700">
              <Sparkles size={14} aria-hidden="true" /> YOUR PERSONAL MONEY SPACE
            </Flex>
            <Heading as="h2" size="3xl" maxW="26rem" color="white" letterSpacing="-0.045em" lineHeight="1.08">
              Spend with clarity, not guesswork.
            </Heading>
            <Text maxW="26rem" color="whiteAlpha.800">
              A focused expense tracker that turns everyday transactions into a clear financial picture.
            </Text>
          </Stack>

          <Stack gap="5">
            {benefits.map(({ icon: Icon, title, body }) => (
              <Flex key={title} align="flex-start" gap="3.5">
                <Flex width="9" height="9" flexShrink="0" align="center" justify="center" borderRadius="lg" bg="whiteAlpha.150">
                  <Icon size={17} aria-hidden="true" />
                </Flex>
                <Stack gap="0.5">
                  <Text fontSize="sm" fontWeight="750">{title}</Text>
                  <Text color="whiteAlpha.700" fontSize="xs">{body}</Text>
                </Stack>
              </Flex>
            ))}
          </Stack>
        </Stack>

        <Text position="relative" zIndex="1" color="whiteAlpha.600" fontSize="xs">
          Your data belongs to you.
        </Text>
      </Flex>

      <Flex minH={{ base: "auto", lg: "660px" }} align="center" p={{ base: "6", sm: "9", lg: "11" }}>
        <Stack width="full" gap="7">
          <Flex display={{ base: "flex", lg: "none" }} align="center" gap="3">
            <Flex width="10" height="10" align="center" justify="center" borderRadius="xl" color="white" bg="purple.600">
              <Landmark size={20} aria-hidden="true" />
            </Flex>
            <Text fontWeight="800" fontSize="lg">Simple Ledger</Text>
          </Flex>

          <Stack gap="2">
            <Heading as="h1" size="2xl" color="gray.900" letterSpacing="-0.04em">
              {mode === "login" ? "Welcome back" : "Start your ledger"}
            </Heading>
            <Text color="gray.500">
              {mode === "login"
                ? "Sign in to continue managing your expenses."
                : "Create an account and get a clearer view of your spending."}
            </Text>
          </Stack>

          <Flex p="1" borderRadius="xl" bg="gray.100" role="group" aria-label="Authentication mode">
            <Button
              flex="1"
              size="sm"
              variant="ghost"
              borderRadius="lg"
              color={mode === "login" ? "gray.900" : "gray.500"}
              bg={mode === "login" ? "white" : "transparent"}
              boxShadow={mode === "login" ? "sm" : "none"}
              onClick={() => setMode("login")}
            >
              Sign in
            </Button>
            <Button
              flex="1"
              size="sm"
              variant="ghost"
              borderRadius="lg"
              color={mode === "signup" ? "gray.900" : "gray.500"}
              bg={mode === "signup" ? "white" : "transparent"}
              boxShadow={mode === "signup" ? "sm" : "none"}
              onClick={() => setMode("signup")}
            >
              Create account
            </Button>
          </Flex>

          <AuthModeForm key={mode} mode={mode} />

          <Text color="gray.400" fontSize="xs" textAlign="center">
            By continuing, you agree to keep your account credentials secure.
          </Text>
        </Stack>
      </Flex>
    </SimpleGrid>
  );
}
