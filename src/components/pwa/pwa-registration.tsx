"use client";

import { useEffect } from "react";

/**
 * Whether to register the service worker: always in production, and in development only with
 * `NEXT_PUBLIC_SW_IN_DEV=true`, so Web Push can be tried locally without caching getting in the way
 * of everyday development.
 */
export function shouldRegisterServiceWorker(env: { NODE_ENV?: string; NEXT_PUBLIC_SW_IN_DEV?: string }) {
  return env.NODE_ENV === "production" || env.NEXT_PUBLIC_SW_IN_DEV === "true";
}

export function PwaRegistration() {
  useEffect(() => {
    const viewport = window.visualViewport;
    function updateHeight() {
      document.documentElement.style.setProperty(
        "--available-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      document.documentElement.style.setProperty(
        "--viewport-offset-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    }
    updateHeight();
    viewport?.addEventListener("resize", updateHeight);
    viewport?.addEventListener("scroll", updateHeight);
    window.addEventListener("resize", updateHeight);
    return () => {
      viewport?.removeEventListener("resize", updateHeight);
      viewport?.removeEventListener("scroll", updateHeight);
      window.removeEventListener("resize", updateHeight);
    };
  }, []);
  useEffect(() => {
    // Each variable is read by its full name so Next inlines it into the client bundle.
    const env = { NODE_ENV: process.env.NODE_ENV, NEXT_PUBLIC_SW_IN_DEV: process.env.NEXT_PUBLIC_SW_IN_DEV };
    if ("serviceWorker" in navigator && shouldRegisterServiceWorker(env)) {
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    }
  }, []);

  return null;
}
