import { DomainError } from "@/lib/errors";
import type { FamilyMember } from "@/lib/family/repository";
import type { Todo, TodoAssignee, TodoStatus } from "@/lib/todos/types";
import type { TodoInput, TodoPatch } from "@/lib/validation/todo";

/** What a caller without a family gets from the methods that need one (routes check membership first). */
export const NO_FAMILY_MESSAGE = "Join a family to use the to-do board.";

/** The message for an assignee who isn't a member of the caller's family (the `todos_guard` trigger's check). */
export const ASSIGNEE_OUTSIDE_FAMILY_MESSAGE = "A to-do can only be assigned to a member of its family.";

/** A 404 for a caller without a family. */
export function noFamilyError(): DomainError {
  return new DomainError(NO_FAMILY_MESSAGE, 404);
}

/** A 422 for an assignee outside the caller's family, pointing at the `assigneeMemberId` field. */
export function assigneeOutsideFamilyError(): DomainError {
  return new DomainError(ASSIGNEE_OUTSIDE_FAMILY_MESSAGE, 422, {
    assigneeMemberId: [ASSIGNEE_OUTSIDE_FAMILY_MESSAGE],
  });
}

/**
 * The assignee's display fields, from the family's member list (`getFamily()`), so a whole board
 * needs one family read rather than one per card. A member missing from the list (it can't be, as
 * the trigger and `on delete set null` keep assignees in the family) still shows, without a name.
 */
export function todoAssignee(members: readonly FamilyMember[], memberId: string | null): TodoAssignee | null {
  if (memberId === null) return null;
  const member = members.find((candidate) => candidate.memberId === memberId);
  return {
    memberId,
    name: member?.displayName ?? null,
    color: member?.color ?? null,
    avatarUrl: member?.avatarUrl ?? null,
  };
}

/**
 * Another card already holds this `(family, status, position)` slot, usually because a racing write
 * took it first. Retry a few times: for a move, call `slotNear` again for fresh keys; for `create`,
 * call it again. It is a 409 `DomainError`, so if it escapes the retries the client gets a 409 and
 * re-syncs.
 */
export class PositionTakenError extends DomainError {
  constructor() {
    super("Another change took that spot on the board. Please try again.", 409);
    this.name = "PositionTakenError";
  }
}

/**
 * Where a moved card goes, as `slotNear` finds it: the keys of the cards that will actually sit
 * directly above (`before`) and below (`after`) it in the column, hidden cards included (null for
 * none). The route stores `positionBetween(slot.before, slot.after)`.
 */
export type TodoSlot = {
  before: string | null;
  after: string | null;
};

/** The client's anchors for a move: the visible card that will sit above it, and the one below. */
export type TodoAnchors = {
  beforeId: string | null;
  afterId: string | null;
};

/**
 * The family to-do board. Get it from `getRepositories()`; never import an implementation.
 * Methods take no family id: they act as the signed-in caller, whose family comes from their
 * membership (RLS), never from the client. Every member can do everything on every card of their
 * family; another family's card counts as missing. Cards come back with their assignee's display
 * name, colour and avatar joined from the family.
 */
export interface TodoRepository {
  /**
   * The family's board: every To do and In progress card, and the Done cards completed at or after
   * `doneSince` (an ISO timestamp). Ordered by status (`TODO_STATUSES`), then position. Throws a 404
   * `DomainError` when the caller has no family.
   */
  list(options: { doneSince: string }): Promise<Todo[]>;
  /** The card, or null when the caller's family has no such card. */
  get(id: string): Promise<Todo | null>;
  /**
   * Adds a card at the **top** of `input.status`, created by `userId` (the authenticated caller; RLS
   * refuses anyone else) in the caller's family. The repository computes the key,
   * `positionBetween(null, <the column's first key>)`, so routes and MCP tools don't. Throws
   * `PositionTakenError` when a racing write took that key (retry), a 422 `DomainError` when the
   * assignee isn't in the family, and a 404 one when the caller has no family.
   */
  create(userId: string, input: TodoInput): Promise<Todo>;
  /**
   * Changes the card's title, notes, assignee or due date (status and position change through
   * `setPosition`). Returns null when the caller's family has no such card. Throws a 422
   * `DomainError` when the assignee isn't in the family.
   */
  update(id: string, patch: TodoPatch): Promise<Todo | null>;
  /** Deletes the card, returning false when the caller's family has no such card. */
  delete(id: string): Promise<boolean>;
  /**
   * The slot for a card moved into `status`, anchored on the cards the client saw around the drop
   * (it may not see every card: old Done cards and filtered views hide some). Cards never need to be
   * adjacent, so a hidden card between the anchors is fine:
   * - `beforeId` given: directly below that card. `after` is the next key in the column after it.
   *   `afterId` is then only checked to exist in the column.
   * - Only `afterId` given: directly above that card. `before` is the previous key in the column.
   * - Both null: the top of the column, as `create` places a card.
   * The moving card (`movingId`) is left out of the column when looking for the next or previous key,
   * so a drop where it already sits gets a fresh key between its neighbours (possibly its current
   * one; writing the same key back is harmless).
   *
   * Returns null (answer 409 so the client re-syncs) only when a named anchor isn't a card of the
   * caller's family in `status`, or is the moving card itself.
   */
  slotNear(status: TodoStatus, anchors: TodoAnchors, movingId?: string): Promise<TodoSlot | null>;
  /**
   * Moves the card to `status` at `position` (the caller's `positionBetween(slot.before, slot.after)`
   * from `slotNear`). Returns null when the caller's family has no such card. Throws
   * `PositionTakenError` when another card already holds that key in that column (call `slotNear`
   * again and retry).
   */
  setPosition(id: string, status: TodoStatus, position: string): Promise<Todo | null>;
}
