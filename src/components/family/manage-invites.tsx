"use client";

import { Box, Button, Text } from "@chakra-ui/react";
import { useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { CreateInviteDialog } from "@/components/family/create-invite-dialog";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { DataError, DataLoading } from "@/components/ui/data-state";
import { ListRow } from "@/components/ui/list-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { useApiForm } from "@/hooks/use-api-form";
import { apiRequest } from "@/lib/api/client";
import { afterInvitesChanged } from "@/lib/api/invalidate";
import { FAMILY_INVITES_API_KEY, familyInviteApiUrl, type InvitesResponse } from "@/lib/api/keys";
import { formatDateTime } from "@/lib/calendar";
import type { FamilyInvite } from "@/lib/family/repository";

function InviteRow({ invite }: { invite: FamilyInvite }) {
  const { mutate } = useSWRConfig();
  const form = useApiForm();
  const [revoking, setRevoking] = useState(false);
  const role = invite.role === "parent" ? "Parent" : "Kid";

  function revoke() {
    void form.submit(async () => {
      await apiRequest<void>(familyInviteApiUrl(invite.inviteId), { method: "DELETE" });
      await afterInvitesChanged(mutate);
      setRevoking(false);
    }, { fallback: "Unable to revoke the invite. Please try again." });
  }

  return (
    <ListRow
      title={
        <Box as="span" display="inline-flex" alignItems="center" gap="2">
          Invite for a {role.toLowerCase()}
          <StatusBadge tone={invite.role === "parent" ? "info" : "neutral"}>{role}</StatusBadge>
        </Box>
      }
      meta={`Created by ${invite.createdByName ?? "someone who has left"}`}
      detail={`Expires ${formatDateTime(invite.expiresAt, "en-GB")}`}
      actions={
        <>
          <Button size="xs" variant="outline" onClick={() => setRevoking(true)} aria-label={`Revoke the ${role.toLowerCase()} invite`}>
            Revoke
          </Button>
          {revoking ? (
            <ConfirmDialog
              open
              onOpenChange={(next) => {
                if (!form.pending) setRevoking(next);
              }}
              title="Revoke this invite?"
              description="The code and link stop working right away."
              confirmLabel="Revoke"
              onConfirm={revoke}
              pending={form.pending}
              error={form.error}
            />
          ) : null}
        </>
      }
    />
  );
}

/** Parents' invite management: create an invite, and list or revoke the pending ones. */
export function ManageInvites() {
  const [creating, setCreating] = useState(false);
  const { data, error, mutate } = useSWR<InvitesResponse>(FAMILY_INVITES_API_KEY);

  return (
    <Card>
      <Card.Header
        title="Invites"
        description="Pending invites to your family."
        actions={
          <Button size="sm" variant="solid" colorPalette="brand" onClick={() => setCreating(true)}>
            Invite someone
          </Button>
        }
      />
      <Card.Body>
        {error && !data ? (
          <DataError retry={() => void mutate()} />
        ) : !data ? (
          <DataLoading label="Loading the invites…" />
        ) : data.invites.length === 0 ? (
          <Text textStyle="bodySm" color="fg.muted">
            No pending invites.
          </Text>
        ) : (
          <Box as="ul" m="0" p="0">
            {data.invites.map((invite) => (
              <InviteRow key={invite.inviteId} invite={invite} />
            ))}
          </Box>
        )}
      </Card.Body>
      {creating ? <CreateInviteDialog open onOpenChange={setCreating} /> : null}
    </Card>
  );
}
