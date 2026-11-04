"use client";

import { useMemo } from "react";
import { useSWRConfig, type ScopedMutator } from "swr";

import { useFamilyApi, type FamilyApi } from "@/components/family/family-api";
import {
  afterFamilyChanged,
  afterFamilyDeleted,
  afterFamilyJoined,
  afterInvitesChanged,
  afterMemberRemoved,
  afterNoticeDismissed,
} from "@/lib/api/invalidate";

/**
 * The family's writes, each followed by the refresh it needs (the family, its invites, the notices).
 * Not optimistic: the server can refuse (a wrong password, a name that does not match), so each
 * waits for it and throws its error for the form (`useApiForm`) to show. Nothing is refreshed after
 * a failure.
 */
export function familyWrites(api: FamilyApi, mutate: ScopedMutator) {
  return {
    async createFamily(name: string) {
      await afterFamilyJoined(mutate, await api.createFamily(name));
    },
    async deleteFamily(confirmName: string) {
      await api.deleteFamily(confirmName);
      await afterFamilyDeleted(mutate);
    },
    /** Only checks the code: nothing changes until `joinFamily`. */
    previewInvite: (code: string) => api.previewInvite(code),
    async joinFamily(code: string) {
      await afterFamilyJoined(mutate, await api.joinFamily(code));
    },
    async createKid(input: Parameters<FamilyApi["createKid"]>[0]) {
      await afterFamilyChanged(mutate, await api.createKid(input));
    },
    async createInvite(input: Parameters<FamilyApi["createInvite"]>[0]) {
      const invite = await api.createInvite(input);
      await afterInvitesChanged(mutate);
      return invite;
    },
    async revokeInvite(inviteId: string) {
      await api.revokeInvite(inviteId);
      await afterInvitesChanged(mutate);
    },
    async removeMember(memberId: string) {
      await api.removeMember(memberId);
      await afterMemberRemoved(mutate);
    },
    /** Nothing cached shows a password, so there is nothing to refresh. */
    resetKidPassword: (memberId: string, password: string) => api.resetKidPassword(memberId, password),
    async deleteKidAccount(memberId: string, input: Parameters<FamilyApi["deleteKidAccount"]>[1]) {
      await afterFamilyChanged(mutate, await api.deleteKidAccount(memberId, input));
    },
    async setPermissions(memberId: string, permissions: Parameters<FamilyApi["setPermissions"]>[1]) {
      await afterFamilyChanged(mutate, await api.setPermissions(memberId, permissions));
    },
    async setColor(memberId: string, color: number | null) {
      await afterFamilyChanged(mutate, await api.setColor(memberId, color));
    },
    async dismissNotice(id: string) {
      await api.dismissNotice(id);
      await afterNoticeDismissed(mutate, id);
    },
  };
}

export function useFamilyWrites() {
  const api = useFamilyApi();
  const { mutate } = useSWRConfig();
  return useMemo(() => familyWrites(api, mutate), [api, mutate]);
}
