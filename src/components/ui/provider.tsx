"use client";

import { ChakraProvider } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";

import { ApiError, apiFetcher } from "@/lib/api/client";
import { ledgerSystem } from "@/components/ui/theme";
import { PwaInstallProvider } from "@/components/pwa/install-instructions";

const swrConfig = {
  fetcher: apiFetcher,
  keepPreviousData: false,
  revalidateOnFocus: false,
  dedupingInterval: 15_000,
  errorRetryCount: 2,
  errorRetryInterval: 3_000,
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
          <PwaInstallProvider>{children}</PwaInstallProvider>
        </ThemeProvider>
      </SWRConfig>
    </ChakraProvider>
  );
}
