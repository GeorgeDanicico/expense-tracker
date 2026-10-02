"use client";

import { Button, Stack, Text } from "@chakra-ui/react";
import { Download } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

const InstallContext = createContext<{
  prompt: InstallEvent | null;
  dismiss: () => void;
}>({ prompt: null, dismiss: () => undefined });

export function PwaInstallProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  useEffect(() => {
    function available(event: Event) {
      event.preventDefault();
      setPrompt(event as InstallEvent);
    }
    function installed() {
      setPrompt(null);
    }
    window.addEventListener("beforeinstallprompt", available);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", available);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  return (
    <InstallContext.Provider value={{ prompt, dismiss: () => setPrompt(null) }}>
      {children}
    </InstallContext.Provider>
  );
}

function getPlatform() {
  if (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  )
    return "standalone";
  if (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  )
    return "ios";
  return /Android/.test(navigator.userAgent) ? "android" : "desktop";
}
function subscribePlatform(callback: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", callback);
  window.addEventListener("appinstalled", callback);
  return () => {
    media.removeEventListener("change", callback);
    window.removeEventListener("appinstalled", callback);
  };
}

export function InstallInstructions() {
  const { prompt, dismiss } = useContext(InstallContext);
  const platform = useSyncExternalStore(
    subscribePlatform,
    getPlatform,
    () => "standalone",
  );
  if (platform === "standalone") return null;
  return (
    <Stack px="3" pt="3" gap="2" borderTopWidth="1px" borderColor="border">
      {prompt ? (
        <Button
          variant="outline"
          onClick={async () => {
            await prompt.prompt();
            await prompt.userChoice;
            dismiss();
          }}
        >
          <Download size={17} aria-hidden="true" /> Install Simple Ledger
        </Button>
      ) : (
        <>
          <Text fontSize="sm" fontWeight="500">
            Install Simple Ledger
          </Text>
          <Text fontSize="xs" color="muted">
            {platform === "ios"
              ? "In Safari, open Share, then Add to Home Screen."
              : platform === "android"
                ? "Open your browser menu and choose Install app or Add to Home screen."
                : "Use your browser’s install icon or menu. If unavailable, open this site in Chrome or Edge."}
          </Text>
        </>
      )}
    </Stack>
  );
}
