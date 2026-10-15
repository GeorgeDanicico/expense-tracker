import { randomUUID } from "node:crypto";

import { DomainError } from "@/lib/errors";
import type {
  NetWorthItemChanges,
  NetWorthItemCreateInput,
  NetWorthRepository,
  NetWorthValuationInput,
} from "@/lib/net-worth/repository";
import type { NetWorthManualItemSource, NetWorthValuation } from "@/lib/net-worth/types";

/** A stored item: the item's fields and its owner, without its valuations. */
export type FakeNetWorthItem = Omit<NetWorthManualItemSource, "valuations"> & { userId: string };

const byNewest = (left: NetWorthValuation, right: NetWorthValuation) =>
  right.valuedOn.localeCompare(left.valuedOn) || right.id.localeCompare(left.id);

/**
 * In-memory `NetWorthRepository`. Seed it with `seed(userId, ...items)`, or set `items` (by id, with
 * their owner) and `valuations` (by id) directly. Like the database, an item date holds one valuation.
 */
export class FakeNetWorthRepository implements NetWorthRepository {
  readonly items = new Map<string, FakeNetWorthItem>();
  readonly valuations = new Map<string, NetWorthValuation>();

  /** Stores `items` and their valuations as `userId`'s. */
  seed(userId: string, ...items: NetWorthManualItemSource[]) {
    for (const { valuations, ...item } of items) {
      this.items.set(item.id, { ...item, userId });
      for (const valuation of valuations) this.valuations.set(valuation.id, valuation);
    }
  }

  async listActiveItems(userId: string) {
    return [...this.items.values()]
      .filter((item) => item.userId === userId && item.archivedAt === null)
      .sort((left, right) => left.category.localeCompare(right.category) || left.name.localeCompare(right.name))
      .slice(0, 500)
      .map((item): NetWorthManualItemSource => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        category: item.category,
        currency: item.currency,
        purchaseAmount: item.purchaseAmount,
        archivedAt: item.archivedAt,
        valuations: this.valuationsOf(item.id).slice(0, 2),
      }));
  }

  async getItem(userId: string, itemId: string) {
    const item = this.ownedItem(userId, itemId);
    return item ? { id: item.id, kind: item.kind, category: item.category, archivedAt: item.archivedAt } : null;
  }

  async createItem(userId: string, { value, valuedOn, ...input }: NetWorthItemCreateInput) {
    const itemId = randomUUID();
    this.items.set(itemId, { id: itemId, userId, archivedAt: null, ...input });
    const valuationId = randomUUID();
    this.valuations.set(valuationId, { id: valuationId, itemId, value, valuedOn });
    return { itemId };
  }

  async updateItem(userId: string, itemId: string, changes: NetWorthItemChanges) {
    const item = this.ownedItem(userId, itemId);
    if (item) this.items.set(itemId, { ...item, ...changes });
  }

  async saveValuation(_userId: string, itemId: string, input: NetWorthValuationInput) {
    const existing = this.valuationsOf(itemId).find((valuation) => valuation.valuedOn === input.valuedOn);
    const valuation = { id: existing?.id ?? randomUUID(), itemId, ...input };
    this.valuations.set(valuation.id, valuation);
    return valuation;
  }

  async updateValuation(userId: string, valuationId: string, input: NetWorthValuationInput) {
    const existing = this.valuations.get(valuationId);
    if (!existing || !this.ownedItem(userId, existing.itemId)) return null;
    const clash = this.valuationsOf(existing.itemId)
      .some((valuation) => valuation.id !== valuationId && valuation.valuedOn === input.valuedOn);
    if (clash) throw new DomainError("A valuation for this date already exists.", 409);

    const valuation = { ...existing, ...input };
    this.valuations.set(valuationId, valuation);
    return valuation;
  }

  private ownedItem(userId: string, itemId: string) {
    const item = this.items.get(itemId);
    return item?.userId === userId ? item : undefined;
  }

  private valuationsOf(itemId: string) {
    return [...this.valuations.values()].filter((valuation) => valuation.itemId === itemId).sort(byNewest);
  }
}
