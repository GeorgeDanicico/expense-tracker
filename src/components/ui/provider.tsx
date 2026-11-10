"use client";

import { ChakraProvider } from "@chakra-ui/react";
import { LucideProvider } from "lucide-react";
import { ThemeProvider } from "next-themes";
import { SWRConfig, type SWRConfiguration } from "swr";

import { apiFetcher, retryDelay } from "@/lib/api/client";
import { redirectIfPasswordChangeRequired } from "@/lib/api/password-change";
import { clearSlow, markSlow } from "@/lib/api/slow-keys";
import { ICON, ICON_STROKE } from "@/components/ui/icon";
import { ledgerSystem } from "@/components/ui/theme";
import { PwaInstallProvider } from "@/components/pwa/install-instructions";

/** A first load still waiting after this long is "slow": `DataLoading` says so and offers a retry (PF2). */
const LOADING_SLOW_MS = 8_000;

const swrConfig: SWRConfiguration = {
  fetcher: apiFetcher,
  keepPreviousData: false,
  revalidateOnFocus: false,
  dedupingInterval: 15_000,
  errorRetryCount: 2,
  loadingTimeout: LOADING_SLOW_MS,
  onLoadingSlow: (key) => markSlow(key),
  onSuccess: (_data, key) => clearSlow(key),
  // A 403 `password_change_required` sends the browser to choose a new password (audit P4). A 401 sends
  // it to sign in from `apiFetcher`, which every request goes through.
  onError: (error, key) => {
    clearSlow(key);
    redirectIfPasswordChangeRequired(error);
  },
  // Which errors are worth another try, and for how long, is `retryDelay`'s to say.
  onErrorRetry: (error, key, config, revalidate, { retryCount }) => {
    const delay = retryDelay(key, error, retryCount, config.errorRetryCount ?? 0);
    if (delay !== null) setTimeout(revalidate, delay, { retryCount, dedupe: true });
  },
};

/** `nonce`: the request's CSP nonce, for next-themes' inline script (see `src/app/layout.tsx`). */
export function Provider({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <ChakraProvider value={ledgerSystem}>
      <SWRConfig value={swrConfig}>
        <ThemeProvider
          attribute="class"
          forcedTheme="light"
          disableTransitionOnChange
          nonce={nonce}
        >
          <LucideProvider size={ICON.sm} strokeWidth={ICON_STROKE}>
            <PwaInstallProvider>{children}</PwaInstallProvider>
          </LucideProvider>
        </ThemeProvider>
      </SWRConfig>
    </ChakraProvider>
  );
}
