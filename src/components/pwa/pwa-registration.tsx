"use client";

import { useEffect } from "react";

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
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    }
  }, []);

  return null;
}
