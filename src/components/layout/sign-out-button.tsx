"use client";

import { Alert, Button, Stack } from "@chakra-ui/react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSWRConfig } from "swr";
import { apiRequest } from "@/lib/api/client";

export function SignOutButton() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function signOut() {
    setPending(true);
    setError("");
    try {
      await apiRequest<{ success: true }>("/api/auth", { method: "DELETE" });
      await mutate(() => true, undefined, { revalidate: false });
      router.replace("/login");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to sign out. Try again.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Stack gap="2">
      <Button
        onClick={signOut}
        loading={pending}
        variant="ghost"
        justifyContent="flex-start"
        color="muted"
      >
        <LogOut size={18} aria-hidden="true" /> Sign out
      </Button>
      {error ? (
        <Alert.Root status="error">
          <Alert.Description>{error}</Alert.Description>
        </Alert.Root>
      ) : null}
    </Stack>
  );
}
