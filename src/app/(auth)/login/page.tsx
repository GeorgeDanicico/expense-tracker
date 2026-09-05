"use client";

import { Center } from "@chakra-ui/react";
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

  if (isLoading || data) return <DataLoading label="Checking your session…" />;
  return (
    <Center
      minH="100dvh"
      px={{ base: "4", md: "6" }}
      py={{ base: "6", md: "10" }}
      bg="linear-gradient(145deg, #f5f3ff 0%, #f8fafc 48%, #eef2ff 100%)"
    >
      <AuthForm />
    </Center>
  );
}
