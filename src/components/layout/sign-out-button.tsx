"use client";

import { Button } from "@chakra-ui/react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSWRConfig } from "swr";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/icon-button";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterSignOut } from "@/lib/api/invalidate";

/** The sign-out flow: the button opens a confirmation, and only "Yes, log me out" signs out. */
function useSignOut() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [confirming, setConfirming] = useState(false);

  function signOut() {
    void form.submit(async () => {
      await apiRequest<{ success: true }>("/api/auth", { method: "DELETE" });
      await afterSignOut(mutate);
      router.replace("/login");
    }, { fallback: "Unable to sign out. Try again." });
  }

  const dialog = (
    <ConfirmDialog
      open={confirming}
      onOpenChange={(open) => {
        if (form.pending) return;
        setConfirming(open);
        if (!open) form.reset();
      }}
      title="Are you sure you want to log out?"
      description="You'll need your email or username and password to sign back in."
      confirmLabel="Yes, log me out"
      cancelLabel="No"
      tone="brand"
      cancelTone="orange"
      pending={form.pending}
      error={form.error}
      onConfirm={signOut}
    />
  );
  return { open: () => setConfirming(true), dialog };
}

/** Full-width sign-out row (More sheet). */
export function SignOutButton() {
  const { open, dialog } = useSignOut();
  return (
    <>
      <Button
        onClick={open}
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
      {dialog}
    </>
  );
}

/** Icon-only sign-out with a tooltip (sidebar account row). */
export function SignOutIconButton() {
  const { open, dialog } = useSignOut();
  return (
    <>
      <IconButton aria-label="Sign out" size="xs" tooltip onClick={open}>
        <LogOut size={ICON.xs} strokeWidth={ICON_STROKE} />
      </IconButton>
      {dialog}
    </>
  );
}
