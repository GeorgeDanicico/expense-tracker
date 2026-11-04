"use client";

import { Button, Flex, Stack } from "@chakra-ui/react";
import { ImageUp, Trash2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";

import { AVATAR_TYPES } from "@/components/settings/settings-api";
import { useSettingsWrites } from "@/components/settings/use-settings-writes";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";

/** The fallback name: the sign-in name's part before any `@` (`AccountData` has no display name yet). */
export function avatarName(signInName: string) {
  return signInName.split("@")[0] || signInName;
}

/** Settings → Profile picture. Only ever changes the signed-in user's own picture. */
export function AvatarCard({ signInName, avatarUrl }: { signInName: string; avatarUrl: string | null }) {
  const writes = useSettingsWrites();
  const form = useApiForm();
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState(false);
  const name = avatarName(signInName);

  function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still fires `change`.
    event.target.value = "";
    if (!file || form.pending) return;
    void form.submit(async () => {
      await writes.uploadAvatar(file);
    }, { fallback: "Unable to upload your picture. Please try again.", action: "upload" });
  }

  function remove() {
    void form.submit(async () => {
      await writes.removeAvatar();
      setRemoving(false);
    }, { fallback: "Unable to remove your picture. Please try again.", action: "remove" });
  }

  return (
    <Card>
      <Card.Header title="Profile picture" description="Shown to your family. JPG or PNG, up to 5 MB." />
      <Card.Body>
        <Stack gap="3">
          {form.error && !removing ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
          <Flex align="center" gap="4" wrap="wrap">
            <Avatar size="lg" name={name} src={avatarUrl} />
            <Flex gap="2" wrap="wrap">
              <input
                ref={input}
                type="file"
                accept={AVATAR_TYPES.join(",")}
                hidden
                onChange={upload}
                aria-label="Profile picture file"
              />
              <Button
                variant="outline"
                loading={form.pendingAction === "upload"}
                disabled={form.pending}
                onClick={() => {
                  form.reset();
                  input.current?.click();
                }}
              >
                <ImageUp size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" />
                {avatarUrl ? "Change picture" : "Upload picture"}
              </Button>
              {avatarUrl ? (
                <ConfirmDialog
                  open={removing}
                  onOpenChange={(next) => {
                    if (form.pending) return;
                    if (next) form.reset();
                    setRemoving(next);
                  }}
                  trigger={
                    <Button variant="ghost" disabled={form.pending}>
                      <Trash2 size={ICON.sm} strokeWidth={ICON_STROKE} aria-hidden="true" /> Remove
                    </Button>
                  }
                  title="Remove your picture?"
                  description="Your family will see your initials instead."
                  confirmLabel="Remove"
                  onConfirm={remove}
                  pending={form.pendingAction === "remove"}
                  error={form.error}
                />
              ) : null}
            </Flex>
          </Flex>
        </Stack>
      </Card.Body>
    </Card>
  );
}
