"use client";

import { ChakraProvider } from "@chakra-ui/react";
import { LucideProvider } from "lucide-react";
import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";

import { ApiError, apiFetcher } from "@/lib/api/client";
import { redirectIfPasswordChangeRequired } from "@/lib/api/password-change";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { ledgerSystem } from "@/components/ui/theme";
import { PwaInstallProvider } from "@/components/pwa/install-instructions";

const swrConfig = {
  fetcher: apiFetcher,
  keepPreviousData: false,
  revalidateOnFocus: false,
  dedupingInterval: 15_000,
  errorRetryCount: 2,
  errorRetryInterval: 3_000,
  // A 403 `password_change_required` sends the browser to choose a new password (audit P4).
  onError: (error: unknown) => {
    redirectIfPasswordChangeRequired(error);
  },
  shouldRetryOnError: (error: unknown) =>
    !(
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ),
};

export function Provider({ children }: { children: React.ReactNode }) {
  return (
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={swrConfig}>
        <ThemeProvider
          attribute="class"
          forcedTheme="light"
          disableTransitionOnChange
        >
          <LucideProvider size={ICON.sm} strokeWidth={ICON_STROKE}>
            <PwaInstallProvider>{children}</PwaInstallProvider>
          </LucideProvider>
        </ThemeProvider>
      </SWRConfig>
    </ChakraProvider>
  );
}
