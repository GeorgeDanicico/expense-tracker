"use client";

import { Box, Button, Stack, Text } from "@chakra-ui/react";
import { useState } from "react";
import { useSWRConfig } from "swr";

import { PermissionsEditor } from "@/components/family/permissions-editor";
import { AppDialog } from "@/components/ui/app-dialog";
import { FormActions } from "@/components/ui/form-actions";
import { InlineAlert } from "@/components/ui/inline-alert";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterInvitesChanged } from "@/lib/api/invalidate";
import { FAMILY_INVITES_API_KEY, type CreatedInvite } from "@/lib/api/keys";
import { formatDateTime } from "@/lib/calendar";
import { DEFAULT_KID_PERMISSIONS, type FamilyRole, type Permissions } from "@/lib/permissions";

const ROLE_ITEMS = [
  { value: "parent", label: "Parent" },
  { value: "kid", label: "Kid" },
] as const;

/** A button that copies `text` and says so for a moment. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setFailed(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setFailed(true);
    }
  }

  return (
    <Button size="xs" variant="outline" onClick={() => void copy()} aria-label={label}>
      {failed ? "Copy failed" : copied ? "Copied" : "Copy"}
    </Button>
  );
}

/** The code, link and expiry of a freshly created invite, with a warning about who can use it. */
export function InviteResult({ invite, role }: { invite: CreatedInvite; role: FamilyRole }) {
  return (
    <Stack gap="4">
      <Stack gap="1.5">
        <Text textStyle="label">Invite code</Text>
        <Stack direction="row" align="center" justify="space-between" gap="3">
          <Text
            as="span"
            fontFamily="mono"
            fontSize="3xl"
            fontWeight="semibold"
            letterSpacing="0.15em"
            data-testid="invite-code"
          >
            {invite.code}
          </Text>
          <CopyButton text={invite.code} label="Copy invite code" />
        </Stack>
      </Stack>
      <Stack gap="1.5">
        <Text textStyle="label">Invite link</Text>
        <Stack direction="row" align="center" justify="space-between" gap="3">
          <Box minW="0">
            <Text textStyle="bodySm" wordBreak="break-all" data-testid="invite-link">
              {invite.url}
            </Text>
          </Box>
          <CopyButton text={invite.url} label="Copy invite link" />
        </Stack>
      </Stack>
      <Text textStyle="caption">Expires {formatDateTime(invite.expiresAt, "en-GB")}.</Text>
      <InlineAlert status="warning">
        Anyone with this code can join as a {role}. Share it only with them.
      </InlineAlert>
    </Stack>
  );
}

/** Choose a role (and, for a kid, permissions), create the invite and show its code once. */
export function CreateInviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [role, setRole] = useState<FamilyRole>("kid");
  const [permissions, setPermissions] = useState<Permissions>(DEFAULT_KID_PERMISSIONS);
  const [created, setCreated] = useState<{ invite: CreatedInvite; role: FamilyRole } | null>(null);
  const formId = "create-invite";

  function create() {
    void form.submit(async () => {
      const invite = await apiRequest<CreatedInvite>(FAMILY_INVITES_API_KEY, {
        method: "POST",
        body: JSON.stringify(role === "kid" ? { role, permissions } : { role }),
      });
      setCreated({ invite, role });
      await afterInvitesChanged(mutate);
    }, { fallback: "Unable to create the invite. Please try again." });
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => {
        if (!form.pending) onOpenChange(next);
      }}
      title={created ? "Invite created" : "Invite someone"}
      description={created ? "Send them the code or the link. It is shown only once." : "They join your family with a code."}
      footer={
        created ? (
          <FormActions submitLabel="Done" onSubmit={() => onOpenChange(false)} />
        ) : (
          <FormActions submitLabel="Create invite" form={formId} closesDialog pending={form.pending} />
        )
      }
    >
      {created ? (
        <InviteResult invite={created.invite} role={created.role} />
      ) : (
        <form
          id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
        >
          <Stack gap="5">
            {form.error ? <InlineAlert status="error">{form.error}</InlineAlert> : null}
            <Stack gap="1.5">
              <Text textStyle="label">Role</Text>
              <SegmentedControl
                items={ROLE_ITEMS}
                value={role}
                onValueChange={setRole}
                aria-label="Role"
                name="invite-role"
              />
              <Text textStyle="caption">
                {role === "parent" ? "Parents can see and manage the whole family." : "Kids get only what you allow below."}
              </Text>
            </Stack>
            {role === "kid" ? (
              <PermissionsEditor value={permissions} onChange={setPermissions} disabled={form.pending} />
            ) : null}
          </Stack>
        </form>
      )}
    </AppDialog>
  );
}
