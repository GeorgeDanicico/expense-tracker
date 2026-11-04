"use client";

import { useMemo } from "react";
import { useSWRConfig } from "swr";

import { useSettingsApi } from "@/components/settings/settings-api";
import { invalidateAfterAvatarChange } from "@/lib/api/invalidate";

/** Settings' own writes, each followed by the refresh it needs. */
export function useSettingsWrites() {
  const api = useSettingsApi();
  const { mutate } = useSWRConfig();

  return useMemo(
    () => ({
      async uploadAvatar(file: File) {
        await api.uploadAvatar(file);
        await invalidateAfterAvatarChange(mutate);
      },
      async removeAvatar() {
        await api.removeAvatar();
        await invalidateAfterAvatarChange(mutate);
      },
    }),
    [api, mutate],
  );
}
