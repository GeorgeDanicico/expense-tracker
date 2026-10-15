import type { NetWorthItemKind, NetWorthManualItemSource, NetWorthValuation } from "@/lib/net-worth/types";

/** A new manual item with its first valuation. Callers normalize an omitted purchase amount to `null`. */
export type NetWorthItemCreateInput = {
  name: string;
  kind: NetWorthItemKind;
  category: string;
  currency: string;
  purchaseAmount: string | null;
  value: string;
  valuedOn: string;
};

/** What the rules need to know about an existing item before changing it. */
export type NetWorthItemState = {
  id: string;
  kind: NetWorthItemKind;
  category: string;
  archivedAt: string | null;
};

/** The stored fields to change on an item; omitted fields stay as they are. */
export type NetWorthItemChanges = {
  name?: string;
  category?: string;
  purchaseAmount?: string | null;
  archivedAt?: string | null;
};

export type NetWorthValuationInput = {
  value: string;
  valuedOn: string;
};

/**
 * Manual net-worth items and their dated valuations. Get it from `getRepositories()`; never import
 * an implementation. Every method acts on `userId`'s own items only: an item or valuation that
 * belongs to someone else is reported as missing.
 */
export interface NetWorthRepository {
  /**
   * The user's unarchived items, by category and then name (at most 500), each with its two
   * newest valuations, newest first.
   */
  listActiveItems(userId: string): Promise<NetWorthManualItemSource[]>;
  /** The user's item, archived or not, or `null` when it is not theirs. */
  getItem(userId: string, itemId: string): Promise<NetWorthItemState | null>;
  /** Creates an item for the signed-in caller together with its first valuation. */
  createItem(userId: string, input: NetWorthItemCreateInput): Promise<{ itemId: string }>;
  /** Writes `changes` to the user's item; an item that is not theirs is left untouched. */
  updateItem(userId: string, itemId: string, changes: NetWorthItemChanges): Promise<void>;
  /**
   * Sets the value of the user's item on a date, replacing any value already on that date.
   * Check that the item is theirs with `getItem` first.
   */
  saveValuation(userId: string, itemId: string, input: NetWorthValuationInput): Promise<NetWorthValuation>;
  /** Corrects the value and date of a valuation on one of the user's items, or `null` when there is none. */
  updateValuation(userId: string, valuationId: string, input: NetWorthValuationInput): Promise<NetWorthValuation | null>;
}
