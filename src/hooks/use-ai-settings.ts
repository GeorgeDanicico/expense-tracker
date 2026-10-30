"use client";

import useSWR from "swr";

import { apiRequest } from "@/lib/api/client";
import { AI_SETTINGS_API_KEY, type AiSettingsResponse } from "@/lib/api/keys";

/** The caller's Settings → AI state, shared through the `/api/account/ai` SWR cache entry. */
export function useAiSettings() {
  const response = useSWR<AiSettingsResponse>(AI_SETTINGS_API_KEY);
  return {
    get settings() {
      return response.data;
    },
    get error() {
      return response.error;
    },
    get isLoading() {
      return response.isLoading;
    },
    mutate: response.mutate,
  };
}

/** Turns the switch on or off; answers the new settings (403 with the reason for a blocked kid). */
export function setAiEnabled(enabled: boolean) {
  return apiRequest<AiSettingsResponse>(AI_SETTINGS_API_KEY, { method: "PATCH", body: JSON.stringify({ enabled }) });
}
