"use client";

import { createContext, useContext, type ReactNode } from "react";

import { apiRequest, LONG_REQUEST_TIMEOUT_MS } from "@/lib/api/client";
import {
  FAMILY_API_KEY,
  FAMILY_INVITES_API_KEY,
  FAMILY_JOIN_API_URL,
  FAMILY_JOIN_PREVIEW_API_URL,
  FAMILY_KIDS_API_URL,
  dismissNoticeApiUrl,
  familyInviteApiUrl,
  familyMemberAccountApiUrl,
  familyMemberApiUrl,
  familyMemberColorApiUrl,
  familyMemberPasswordApiUrl,
  familyMemberPermissionsApiUrl,
  type CreatedInvite,
  type FamilyResponse,
} from "@/lib/api/keys";
import type { InvitePreviewView } from "@/lib/family/views";
import type { FamilyRole, Permissions } from "@/lib/permissions";

export type NewKidInput = { displayName: string; username: string; password: string; permissions: Permissions };

/**
 * Every family write (audit D6). The app uses the REST API; `/dev/preview` and tests can swap in
 * another one. `useFamilyWrites` calls these and refreshes what each one changes.
 */
export type FamilyApi = {
  createFamily(name: string): Promise<FamilyResponse>;
  deleteFamily(confirmName: string): Promise<void>;
  previewInvite(code: string): Promise<InvitePreviewView>;
  joinFamily(code: string): Promise<FamilyResponse>;
  createKid(input: NewKidInput): Promise<FamilyResponse>;
  createInvite(input: { role: FamilyRole; permissions?: Permissions }): Promise<CreatedInvite>;
  revokeInvite(inviteId: string): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  resetKidPassword(memberId: string, password: string): Promise<void>;
  deleteKidAccount(memberId: string, input: { currentPassword: string; confirmName: string }): Promise<FamilyResponse>;
  setPermissions(memberId: string, permissions: Permissions): Promise<FamilyResponse>;
  setColor(memberId: string, color: number | null): Promise<FamilyResponse>;
  dismissNotice(id: string): Promise<void>;
};

const json = (body: unknown) => JSON.stringify(body);
/** Creating and deleting a kid's account are long writes on the server: wait for its answer. */
const LONG = { timeoutMs: LONG_REQUEST_TIMEOUT_MS };

export const restFamilyApi: FamilyApi = {
  createFamily: (name) => apiRequest<FamilyResponse>(FAMILY_API_KEY, { method: "POST", body: json({ name }) }),
  async deleteFamily(confirmName) {
    await apiRequest<void>(FAMILY_API_KEY, { method: "DELETE", body: json({ confirmName }) });
  },
  previewInvite: (code) => apiRequest<InvitePreviewView>(FAMILY_JOIN_PREVIEW_API_URL, { method: "POST", body: json({ code }) }),
  joinFamily: (code) => apiRequest<FamilyResponse>(FAMILY_JOIN_API_URL, { method: "POST", body: json({ code }) }),
  createKid: (input) => apiRequest<FamilyResponse>(FAMILY_KIDS_API_URL, { method: "POST", body: json(input) }, LONG),
  createInvite: (input) =>
    apiRequest<CreatedInvite>(FAMILY_INVITES_API_KEY, {
      method: "POST",
      body: json(input.role === "kid" ? { role: input.role, permissions: input.permissions } : { role: input.role }),
    }),
  async revokeInvite(inviteId) {
    await apiRequest<void>(familyInviteApiUrl(inviteId), { method: "DELETE" });
  },
  async removeMember(memberId) {
    await apiRequest<void>(familyMemberApiUrl(memberId), { method: "DELETE" });
  },
  async resetKidPassword(memberId, password) {
    await apiRequest<unknown>(familyMemberPasswordApiUrl(memberId), { method: "POST", body: json({ password }) });
  },
  deleteKidAccount: (memberId, input) =>
    apiRequest<FamilyResponse>(familyMemberAccountApiUrl(memberId), { method: "DELETE", body: json(input) }, LONG),
  setPermissions: (memberId, permissions) =>
    apiRequest<FamilyResponse>(familyMemberPermissionsApiUrl(memberId), { method: "PATCH", body: json({ permissions }) }),
  setColor: (memberId, color) => apiRequest<FamilyResponse>(familyMemberColorApiUrl(memberId), { method: "PATCH", body: json({ color }) }),
  async dismissNotice(id) {
    await apiRequest(dismissNoticeApiUrl(id), { method: "POST" });
  },
};

const FamilyApiContext = createContext<FamilyApi>(restFamilyApi);

export function FamilyApiProvider({ api, children }: { api: FamilyApi; children: ReactNode }) {
  return <FamilyApiContext.Provider value={api}>{children}</FamilyApiContext.Provider>;
}

export function useFamilyApi() {
  return useContext(FamilyApiContext);
}
