"use client";

import { createContext, useContext, type ReactNode } from "react";

import { apiRequest } from "@/lib/api/client";
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
 * The requests Settings makes itself (audit D6). The cards that call a helper in `src/lib` (currency,
 * export, tokens, notifications) already keep their requests out of the components; the profile
 * picture's lived here.
 */
export type SettingsApi = {
  /** The raw bytes, with the file's own type as `Content-Type`. A file the browser refuses throws its message without a request. */
  uploadAvatar(file: File): Promise<{ avatarUrl: string }>;
  removeAvatar(): Promise<void>;
};

export const restSettingsApi: SettingsApi = {
  async uploadAvatar(file) {
    const refused = validateAvatarFile(file);
    if (refused) throw new Error(refused);
    // `apiRequest` lets `init.headers` override its JSON default.
    return apiRequest<{ avatarUrl: string }>(ACCOUNT_AVATAR_API_URL, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
  },
  removeAvatar: () => apiRequest<void>(ACCOUNT_AVATAR_API_URL, { method: "DELETE" }),
};

const SettingsApiContext = createContext<SettingsApi>(restSettingsApi);

export function SettingsApiProvider({ api, children }: { api: SettingsApi; children: ReactNode }) {
  return <SettingsApiContext.Provider value={api}>{children}</SettingsApiContext.Provider>;
}

export function useSettingsApi() {
  return useContext(SettingsApiContext);
}
