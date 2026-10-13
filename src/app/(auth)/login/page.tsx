"use client";

import { Box, Center } from "@chakra-ui/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";

import { AuthForm } from "@/components/auth/auth-form";
import { DataLoading } from "@/components/ui/data-state";
import { ACCOUNT_API_KEY } from "@/lib/api/keys";
import type { AccountData } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const { data, isLoading } = useSWR<AccountData>(ACCOUNT_API_KEY);

  useEffect(() => {
    if (data) router.replace("/dashboard");
  }, [data, router]);

  if (isLoading || data) {
    return (
      <Center minH="100dvh" px="4">
        <Box width="full" maxW="360px">
          <DataLoading layout="section" label="Checking your session…" />
        </Box>
      </Center>
    );
  }
  return (
    <Center
      minH="100dvh"
      px={{ base: "4", md: "6" }}
      py={{ base: "6", md: "10" }}
      bg="bg.canvas"
    >
      <AuthForm />
    </Center>
  );
}
