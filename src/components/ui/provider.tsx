"use client";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ThemeProvider } from "next-themes";
import { SWRConfig } from "swr";

import { ApiError, apiFetcher } from "@/lib/api/client";

const swrConfig = {
  fetcher: apiFetcher,
  keepPreviousData: true,
  revalidateOnFocus: false,
  dedupingInterval: 15_000,
  errorRetryCount: 2,
  errorRetryInterval: 3_000,
  shouldRetryOnError: (error: unknown) =>
    !(error instanceof ApiError && (error.status === 401 || error.status === 403)),
};

export function Provider({ children }: { children: React.ReactNode }) {
  return (
    <ChakraProvider value={defaultSystem}>
      <SWRConfig value={swrConfig}>
        <ThemeProvider attribute="class" forcedTheme="light" disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </SWRConfig>
    </ChakraProvider>
  );
}
