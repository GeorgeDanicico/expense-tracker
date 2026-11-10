import "server-only";

import type { z } from "zod";

import { getInvestmentsOverview } from "@/lib/investments/service";
import { DomainError } from "@/lib/errors";
import { buildNetWorthOverview, combineNetWorthTotals } from "@/lib/net-worth/calculation";
import type { FamilyNetWorthOverview } from "@/lib/net-worth/types";
import type { NetWorthItemChanges, NetWorthValuationInput } from "@/lib/net-worth/repository";
import { purchaseAmountAllowed } from "@/lib/net-worth/rules";
import { getRepositories } from "@/lib/repositories";
import type { netWorthItemPatchSchema } from "@/lib/validation/net-worth";

export type NetWorthItemPatchInput = z.output<typeof netWorthItemPatchSchema>;

/** The most active manual items in one overview; more are refused, never cut off (B11). */
export const MAX_ACTIVE_ITEMS = 500;

/** The 409 for more than `MAX_ACTIVE_ITEMS` items: retrying won't help, so it says what will. */
export const TOO_MANY_ITEMS_MESSAGE =
  `There are more than ${new Intl.NumberFormat("en").format(MAX_ACTIVE_ITEMS)} net-worth items, more than the app can show. Nothing is lost. Ask whoever runs the app to raise the limit.`;

/**
 * The user's net worth: their investments combined with their active manual items. Refuses (409)
 * more than `MAX_ACTIVE_ITEMS` items, since a total that leaves some out would be wrong, and an
 * investment account over its own cap (`getInvestmentsOverview`).
 */
export async function getNetWorthOverview(userId: string) {
  const investmentsPromise = getInvestmentsOverview(userId);
  const manualItemsPromise = getRepositories().netWorth.listActiveItems(userId, MAX_ACTIVE_ITEMS + 1);
  const [investments, manualItems] = await Promise.all([investmentsPromise, manualItemsPromise]);
  if (manualItems.length > MAX_ACTIVE_ITEMS) throw new DomainError(TOO_MANY_ITEMS_MESSAGE, 409);

  return buildNetWorthOverview(investments, manualItems);
}

/**
 * Every viewer's net worth, one overview each in the order given, plus their totals added up per
 * currency. Nothing is converted between currencies.
 */
export async function getFamilyNetWorthOverview(
  viewers: Array<{ userId: string; memberId: string; name: string; currency: string }>,
): Promise<FamilyNetWorthOverview> {
  const members = await Promise.all(
    viewers.map(async ({ userId, memberId, name, currency }) => ({
      memberId,
      name,
      currency,
      overview: await getNetWorthOverview(userId),
    })),
  );
  return { members, totalsByCurrency: combineNetWorthTotals(members.map(({ overview }) => overview.totalsByCurrency)) };
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
