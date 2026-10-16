"use client";

import { Box, Center } from "@chakra-ui/react";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { DataLoading } from "@/components/ui/data-state";
import { useAccount } from "@/hooks/use-account";

/** The sign-in screen. `next` is already a safe same-site path; signed-in visitors go straight there. */
export function LoginView({ next }: { next: string }) {
  const router = useRouter();
  const { account: data, isLoading } = useAccount();

  useEffect(() => {
    if (data) router.replace(next);
  }, [data, next, router]);

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
      <Suspense>
        <AuthForm next={next} />
      </Suspense>
    </Center>
  );
}
