"use client";

import { Button, Flex, Stack } from "@chakra-ui/react";
import { ImageUp, Trash2 } from "lucide-react";
import { useRef, useState, type ChangeEvent } from "react";
import { useSWRConfig } from "swr";

import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { InlineAlert } from "@/components/ui/inline-alert";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { invalidateAfterAvatarChange } from "@/lib/api/invalidate";
import { ACCOUNT_AVATAR_API_URL } from "@/lib/api/keys";

/** The types the server accepts; it checks the file's bytes again. */
export const AVATAR_TYPES = ["image/jpeg", "image/png"] as const;
/** The server's upload limit (5 MB). */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

/** Why the browser refuses `file` before sending it, or `null` when it may be sent. */
export function validateAvatarFile(file: Pick<File, "type" | "size">): string | null {
  if (!(AVATAR_TYPES as readonly string[]).includes(file.type)) return "Choose a JPG or PNG image.";
  if (file.size > AVATAR_MAX_BYTES) return "Choose an image under 5 MB.";
  return null;
}

/**
 * Uploads `file` as the signed-in user's picture: the raw bytes, with the file's own type as the
 * `Content-Type` (`apiRequest` lets `init.headers` override its JSON default). A file the browser
 * refuses throws its message without a request.
 */
export async function uploadAvatar(file: File) {
  const refused = validateAvatarFile(file);
  if (refused) throw new Error(refused);
  return apiRequest<{ avatarUrl: string }>(ACCOUNT_AVATAR_API_URL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type },
  });
}

/** Removes the signed-in user's picture. */
export function removeAvatar() {
  return apiRequest<void>(ACCOUNT_AVATAR_API_URL, { method: "DELETE" });
}

/** The fallback name: the email's part before the `@` (`AccountData` has no display name yet). */
export function avatarName(email: string) {
  return email.split("@")[0] || email;
}

/** Settings → Profile picture. Only ever changes the signed-in user's own picture. */
export function AvatarCard({ email, avatarUrl }: { email: string; avatarUrl: string | null }) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState(false);
  const name = avatarName(email);

  function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again still fires `change`.
    event.target.value = "";
    if (!file || form.pending) return;
    void form.submit(async () => {
      await uploadAvatar(file);
      await invalidateAfterAvatarChange(mutate);
    }, { fallback: "Unable to upload your picture. Please try again.", action: "upload" });
  }

  function remove() {
    void form.submit(async () => {
      await removeAvatar();
      await invalidateAfterAvatarChange(mutate);
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
