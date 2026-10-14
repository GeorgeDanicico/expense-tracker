"use client";

import { Button, Stack } from "@chakra-ui/react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";

import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterSignOut } from "@/lib/api/invalidate";

function useSignOut() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  function signOut() {
    void form.submit(async () => {
      await apiRequest<{ success: true }>("/api/auth", { method: "DELETE" });
      await afterSignOut(mutate);
      router.replace("/login");
    }, { fallback: "Unable to sign out. Try again." });
  }
  return { signOut, pending: form.pending, error: form.error };
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
