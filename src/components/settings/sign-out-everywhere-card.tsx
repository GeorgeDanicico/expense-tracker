"use client";

import { Button } from "@chakra-ui/react";
import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useSWRConfig } from "swr";

import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { useApiForm } from "@/hooks/use-api-form";
import { forgetThisDeviceBeforeSignOut } from "@/hooks/use-notification-settings";
import { signOutEverywhere } from "@/lib/api/account-requests";
import { afterSignOut } from "@/lib/api/invalidate";

/**
 * Settings → Account: signs out every session of the account, this one included (a lost phone, a
 * shared computer). The button opens a confirmation; only its confirm button signs out, then this
 * browser goes to the sign-in page. Like the ordinary sign-out, it first turns off this device's
 * notifications (best effort).
 */
export function SignOutEverywhereCard() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [confirming, setConfirming] = useState(false);

  function confirm() {
    void form.submit(async () => {
      await forgetThisDeviceBeforeSignOut();
      await signOutEverywhere();
      await afterSignOut(mutate);
      router.replace("/login");
    }, { fallback: "Unable to sign out everywhere. Please try again." });
  }

  return (
    <Card>
      <Card.Header
        title="Sign out everywhere"
        description="Signs your account out on every phone, computer and browser, this one included. Use it if you lost a device or signed in somewhere you shouldn't stay signed in."
      />
      <Card.Footer justifyContent="flex-end" borderTopWidth="1px" pt="3">
        <ConfirmDialog
          open={confirming}
          onOpenChange={(open) => {
            if (form.pending) return;
            if (open) form.reset();
            setConfirming(open);
          }}
          trigger={
            <Button variant="outline">
              <LogOut size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Sign out everywhere
            </Button>
          }
          title="Sign out everywhere?"
          description="Every device signed in to your account is signed out, this one too, and has to sign in again. Connected AI apps may ask you to sign in again."
          confirmLabel="Sign out everywhere"
          onConfirm={confirm}
          pending={form.pending}
          error={form.error}
        />
      </Card.Footer>
    </Card>
  );
}
