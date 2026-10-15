import "server-only";

import type { z } from "zod";

import { getInvestmentsOverviewForUser } from "@/lib/data/investments";
import { DomainError } from "@/lib/errors";
import { buildNetWorthOverview } from "@/lib/net-worth/calculation";
import type { NetWorthItemChanges, NetWorthValuationInput } from "@/lib/net-worth/repository";
import { purchaseAmountAllowed } from "@/lib/net-worth/rules";
import { getRepositories } from "@/lib/repositories";
import type { netWorthItemPatchSchema } from "@/lib/validation/net-worth";

export type NetWorthItemPatchInput = z.output<typeof netWorthItemPatchSchema>;

/** The user's net worth: their investments combined with their active manual items. */
export async function getNetWorthOverview(userId: string) {
  const investmentsPromise = getInvestmentsOverviewForUser(userId);
  const manualItemsPromise = getRepositories().netWorth.listActiveItems(userId);
  const [investments, manualItems] = await Promise.all([investmentsPromise, manualItemsPromise]);

  return buildNetWorthOverview(investments, manualItems);
}

/**
 * Applies a patch to the user's item. Returns `false` when the item is not theirs. Switching to
 * cash clears the purchase amount, and archiving stamps the current time.
 */
export async function updateNetWorthItem(userId: string, itemId: string, input: NetWorthItemPatchInput) {
  const { netWorth } = getRepositories();
  const existing = await netWorth.getItem(userId, itemId);
  if (!existing) return false;

  if (
    !purchaseAmountAllowed(existing.kind, input.category ?? existing.category)
    && input.purchaseAmount !== undefined
    && input.purchaseAmount !== null
  ) {
    throw new DomainError(
      "Purchase amount is only available for non-cash assets.",
      422,
      { purchaseAmount: ["Purchase amount is only available for non-cash assets."] },
    );
  }

  const changes: NetWorthItemChanges = {};
  if (input.name !== undefined) changes.name = input.name;
  if (input.category !== undefined) {
    changes.category = input.category;
    if (input.category === "cash") changes.purchaseAmount = null;
  }
  if (input.purchaseAmount !== undefined) changes.purchaseAmount = input.purchaseAmount;
  if (input.archived !== undefined) {
    changes.archivedAt = input.archived ? new Date().toISOString() : null;
  }

  await netWorth.updateItem(userId, itemId, changes);
  return true;
}

/** Sets the value of the user's item on a date. Returns `null` when the item is not theirs. */
export async function addNetWorthValuation(userId: string, itemId: string, input: NetWorthValuationInput) {
  const { netWorth } = getRepositories();
  const item = await netWorth.getItem(userId, itemId);
  if (!item) return null;
  if (item.archivedAt) {
    throw new DomainError("Archived items cannot receive new values.", 409);
  }

  return netWorth.saveValuation(userId, itemId, input);
}
