"use client";

import { useSyncExternalStore } from "react";

function subscribe(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** Whether the device has a connection (`navigator.onLine`); true while rendering on the server. */
export function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}
