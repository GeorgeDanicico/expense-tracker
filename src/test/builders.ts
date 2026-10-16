import type { Expense } from "@/lib/expenses/types";
import type { ExpenseTab } from "@/lib/expenses/tabs";
import { PARENT_PERMISSIONS, type CurrentMember, type FamilyData, type FamilyMember } from "@/lib/family/repository";
import type { InvestmentTransaction } from "@/lib/investments/types";
import type { NetWorthManualItemSource, NetWorthValuation } from "@/lib/net-worth/types";
import { DEFAULT_KID_PERMISSIONS } from "@/lib/permissions";

/** Test fixtures with readable defaults; override only what a test is about. */

export function anExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense-1",
    description: "Groceries",
    amount: 10,
    category: "groceries",
    subtype: null,
    expenseDate: "2024-02-01",
    notes: null,
    ...overrides,
  };
}

export function aTab(overrides: Partial<ExpenseTab> = {}): ExpenseTab {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    name: "Car",
    categoryKeys: ["car"],
    subtypeKeys: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function aTransaction(overrides: Partial<InvestmentTransaction> = {}): InvestmentTransaction {
  return {
    id: "transaction-1",
    investmentAccountId: "account-xtb",
    instrument: "VWCE.DE",
    currency: "EUR",
    side: "buy",
    amount: "150",
    quantity: "1.5",
    unitPrice: "100",
    executedAt: "2026-01-01T10:00:00Z",
    ...overrides,
  };
}

export function aValuation(overrides: Partial<NetWorthValuation> = {}): NetWorthValuation {
  return { id: "valuation-1", itemId: "item-1", value: "1000", valuedOn: "2026-09-19", ...overrides };
}

/** Defaults to one valuation that belongs to the item. */
export function aManualItem(overrides: Partial<NetWorthManualItemSource> = {}): NetWorthManualItemSource {
  const id = overrides.id ?? "item-1";
  return {
    id,
    name: "Current account",
    kind: "asset",
    category: "cash",
    currency: "EUR",
    purchaseAmount: null,
    archivedAt: null,
    valuations: [aValuation({ id: `${id}-valuation`, itemId: id })],
    ...overrides,
  };
}

/** A parent's membership, as `getCurrentMember()` returns it. Seed it on `repositories.family.membership`. */
export function aParent(overrides: Partial<CurrentMember> = {}): CurrentMember {
  return {
    memberId: "60000000-0000-4000-8000-000000000001",
    familyId: "70000000-0000-4000-8000-000000000001",
    familyName: "The Smiths",
    role: "parent",
    isCreator: true,
    permissions: PARENT_PERMISSIONS,
    ...overrides,
  };
}

/** A kid's membership with the default kid permissions; override `permissions` for what a test is about. */
export function aKid(overrides: Partial<CurrentMember> = {}): CurrentMember {
  return {
    memberId: "60000000-0000-4000-8000-000000000002",
    familyId: "70000000-0000-4000-8000-000000000001",
    familyName: "The Smiths",
    role: "kid",
    isCreator: false,
    permissions: DEFAULT_KID_PERMISSIONS,
    ...overrides,
  };
}

/** A family as `getFamily()` returns it to its creator: the family and the creator's own entry. */
export function aFamily(overrides: Partial<FamilyData["family"]> = {}): FamilyData {
  return {
    family: {
      id: "70000000-0000-4000-8000-000000000001",
      name: "The Smiths",
      createdAt: "2026-10-01T09:00:00.000Z",
      ...overrides,
    },
    members: [
      {
        memberId: "60000000-0000-4000-8000-000000000001",
        userId: "10000000-0000-4000-8000-000000000001",
        role: "parent",
        isCreator: true,
        displayName: "owner",
        username: null,
        joinedAt: "2026-10-01T09:00:00.000Z",
        lastActiveAt: null,
        permissions: PARENT_PERMISSIONS,
      },
    ],
  };
}

/**
 * A kid's entry in `FamilyData.members`, as a parent sees it. Add it to `aFamily().members`;
 * override `role` (and `permissions: PARENT_PERMISSIONS`) for a second parent.
 */
export function aFamilyMember(overrides: Partial<FamilyMember> = {}): FamilyMember {
  return {
    memberId: "60000000-0000-4000-8000-000000000002",
    userId: "10000000-0000-4000-8000-000000000002",
    role: "kid",
    isCreator: false,
    displayName: "kid",
    username: "kid",
    joinedAt: "2026-10-02T09:00:00.000Z",
    lastActiveAt: null,
    permissions: DEFAULT_KID_PERMISSIONS,
    ...overrides,
  };
}
