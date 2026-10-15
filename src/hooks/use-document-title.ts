"use client";

import { useEffect } from "react";

import { BRAND } from "@/lib/brand";

export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ${BRAND.name}`;
  }, [title]);
}
