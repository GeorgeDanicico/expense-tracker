"use client";

import { createContext, useContext, type ReactNode } from "react";

import { apiRequest } from "@/lib/api/client";
import type { NetWorthItemKind } from "@/lib/net-worth/types";

/** A new item as the form checked it, with its first value; the server validates the rest. */
export type NetWorthItemInput = {
  name: string;
  kind: NetWorthItemKind;
  category: string;
  currency: string;
  purchaseAmount: string | null;
  value: string;
  /** `YYYY-MM-DD`. */
  valuedOn: string;
};

/** What changes on an item: its details, or `{ archived: true }`. */
export type NetWorthItemPatch = { name: string; category: string; purchaseAmount: string | null } | { archived: true };

export type NetWorthValuationInput = { value: string; valuedOn: string };

const itemUrl = (id: string) => `/api/net-worth/items/${encodeURIComponent(id)}`;

/**
 * Every net-worth write (audit D6). The app uses the REST API; `/dev/preview` swaps in an in-memory
 * one. `useNetWorthWrites` calls these: a new dated value is optimistic (it nearly always succeeds),
 * items wait for the server, which works out the totals.
 */
export type NetWorthApi = {
  createItem(input: NetWorthItemInput): Promise<void>;
  updateItem(id: string, patch: NetWorthItemPatch): Promise<void>;
  /** A value on a date; the same date replaces that observation. */
  addValuation(itemId: string, input: NetWorthValuationInput): Promise<void>;
};

export const restNetWorthApi: NetWorthApi = {
  async createItem(input) {
    await apiRequest<{ itemId: string }>("/api/net-worth/items", { method: "POST", body: JSON.stringify(input) });
  },
  async updateItem(id, patch) {
    await apiRequest<{ success: true }>(itemUrl(id), { method: "PATCH", body: JSON.stringify(patch) });
  },
  async addValuation(itemId, input) {
    await apiRequest<{ valuation: unknown }>(`${itemUrl(itemId)}/valuations`, { method: "POST", body: JSON.stringify(input) });
  },
};

const NetWorthApiContext = createContext<NetWorthApi>(restNetWorthApi);

export function NetWorthApiProvider({ api, children }: { api: NetWorthApi; children: ReactNode }) {
  return <NetWorthApiContext.Provider value={api}>{children}</NetWorthApiContext.Provider>;
}

export function useNetWorthApi() {
  return useContext(NetWorthApiContext);
}
