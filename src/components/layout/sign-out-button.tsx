"use client";

import { Button, Stack } from "@chakra-ui/react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSWRConfig } from "swr";

import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { apiRequest } from "@/lib/api/client";

function useSignOut() {
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
  return { signOut, pending, error };
}

/** Full-width sign-out row (More sheet). */
export function SignOutButton() {
  const { signOut, pending, error } = useSignOut();
  return (
    <Stack gap="2">
      <Button
        onClick={signOut}
        loading={pending}
        variant="ghost"
        size="md"
        h="11"
        px="3"
        justifyContent="flex-start"
        color="fg.muted"
        fontWeight="medium"
      >
        <LogOut size={ICON.nav} strokeWidth={ICON_STROKE} aria-hidden="true" /> Sign out
      </Button>
      {error ? <InlineAlert status="error">{error}</InlineAlert> : null}
    </Stack>
  );
}

/** Icon-only sign-out with a tooltip (sidebar account row). */
export function SignOutIconButton() {
  const { signOut, pending, error } = useSignOut();
  return (
    <>
      <IconButton aria-label="Sign out" size="xs" tooltip onClick={signOut} loading={pending}>
        <LogOut size={ICON.xs} strokeWidth={ICON_STROKE} />
      </IconButton>
      {error ? (
        <Stack position="absolute" insetX="3" bottom="100%" mb="2">
          <InlineAlert status="error">{error}</InlineAlert>
        </Stack>
      ) : null}
    </>
  );
}
