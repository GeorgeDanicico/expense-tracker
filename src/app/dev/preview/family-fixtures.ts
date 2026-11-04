import type { FamilyApi } from "@/components/family/family-api";

import { PREVIEW_FAMILY } from "./fixtures";

/**
 * The family's writes for `/dev/preview`: each answers with the sample family unchanged, so nothing
 * is sent and a dialog can be walked through. An invite shows a made-up code.
 */
export const previewFamilyApi: FamilyApi = {
  createFamily: async () => PREVIEW_FAMILY,
  deleteFamily: async () => undefined,
  previewInvite: async () => ({ familyName: "The Danicicos", inviterName: "George", role: "kid" }),
  joinFamily: async () => PREVIEW_FAMILY,
  createKid: async () => PREVIEW_FAMILY,
  createInvite: async () => ({ code: "PREVIEW-CODE", url: "http://localhost:3000/join/PREVIEW-CODE", expiresAt: "2026-11-11T10:00:00.000Z" }),
  revokeInvite: async () => undefined,
  removeMember: async () => undefined,
  resetKidPassword: async () => undefined,
  deleteKidAccount: async () => PREVIEW_FAMILY,
  setPermissions: async () => PREVIEW_FAMILY,
  setColor: async () => PREVIEW_FAMILY,
  dismissNotice: async () => undefined,
};
