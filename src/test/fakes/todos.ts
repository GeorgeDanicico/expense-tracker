import { randomUUID } from "node:crypto";

import { positionBetween } from "@/lib/todos/position";
import {
  PositionTakenError,
  assigneeOutsideFamilyError,
  noFamilyError,
  todoAssignee,
  type TodoAnchors,
  type TodoRepository,
  type TodoSlot,
} from "@/lib/todos/repository";
import { TODO_STATUSES, type Todo, type TodoStatus } from "@/lib/todos/types";
import type { TodoInput, TodoPatch } from "@/lib/validation/todo";

import type { FakeFamilyRepository } from "./family";

/** A card as the fake stores it: a `Todo` with its family and the raw assignee id instead of the joined assignee. */
export type FakeTodoRow = Omit<Todo, "assignee"> & { familyId: string; assigneeMemberId: string | null };

const byPosition = (a: { position: string }, b: { position: string }) =>
  a.position < b.position ? -1 : a.position > b.position ? 1 : 0;

/**
 * In-memory `TodoRepository` acting as the caller of a `FakeFamilyRepository` (the same one the test
 * seeds): the caller's family is `family.membership.familyId`, the assignees they may pick and the
 * display fields joined onto cards are `family.family.members`, and `completedBy` is `family.caller.userId`.
 * Like the database, it keeps every method to the caller's family (another family's card counts as
 * missing), refuses an assignee outside the family (422), keeps `(family, status, position)` unique
 * (`PositionTakenError`), and sets `completedAt`/`completedBy` when a card enters or leaves Done.
 *
 * `slotNear` sees every card of the column, hidden or not, like the database.
 *
 * Seed cards with `seed({ title, status, position, ... })` (the caller's family by default) or push
 * onto `rows` directly. `failNextWrite` makes the next `create` or `setPosition` throw
 * `PositionTakenError`, to test a route's retry.
 */
export class FakeTodoRepository implements TodoRepository {
  rows: FakeTodoRow[] = [];
  /** How many of the next `create`/`setPosition` calls fail with `PositionTakenError`, as if a racing write won. */
  failNextWrite = 0;

  constructor(private readonly family: FakeFamilyRepository) {}

  /** Adds a card (to the caller's family unless `familyId` says otherwise) and returns it as stored. */
  seed(overrides: Partial<FakeTodoRow> = {}): FakeTodoRow {
    const now = new Date().toISOString();
    const status = overrides.status ?? "todo";
    const familyId = overrides.familyId ?? this.family.membership?.familyId ?? "no-family";
    const row: FakeTodoRow = {
      id: randomUUID(),
      title: "Buy milk",
      notes: "",
      status,
      position: overrides.position ?? this.topPosition(familyId, status),
      assigneeMemberId: null,
      dueDate: null,
      createdBy: this.family.caller.userId,
      createdAt: now,
      updatedAt: now,
      completedAt: status === "done" ? now : null,
      completedBy: status === "done" ? this.family.caller.userId : null,
      ...overrides,
      familyId,
    };
    this.rows.push(row);
    return row;
  }

  async list({ doneSince }: { doneSince: string }) {
    const familyId = this.requireFamily();
    return this.rows
      .filter((row) => row.familyId === familyId)
      .filter((row) => row.status !== "done" || (row.completedAt !== null && row.completedAt >= doneSince))
      .toSorted((a, b) => TODO_STATUSES.indexOf(a.status) - TODO_STATUSES.indexOf(b.status) || byPosition(a, b))
      .map((row) => this.toTodo(row));
  }

  async get(id: string) {
    const row = this.find(id);
    return row ? this.toTodo(row) : null;
  }

  async create(userId: string, input: TodoInput) {
    const familyId = this.requireFamily();
    this.checkAssignee(input.assigneeMemberId);
    const position = this.topPosition(familyId, input.status);
    this.takeSlot(familyId, input.status, position, null);

    const now = new Date().toISOString();
    const done = input.status === "done";
    const row: FakeTodoRow = {
      id: randomUUID(),
      familyId,
      title: input.title,
      notes: input.notes,
      status: input.status,
      position,
      assigneeMemberId: input.assigneeMemberId,
      dueDate: input.dueDate,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      completedAt: done ? now : null,
      completedBy: done ? this.family.caller.userId : null,
    };
    this.rows.push(row);
    return this.toTodo(row);
  }

  async update(id: string, patch: TodoPatch) {
    const row = this.find(id);
    if (!row) return null;
    if (patch.assigneeMemberId !== undefined && patch.assigneeMemberId !== row.assigneeMemberId) {
      this.checkAssignee(patch.assigneeMemberId);
    }
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    Object.assign(row, defined, { updatedAt: new Date().toISOString() });
    return this.toTodo(row);
  }

  async delete(id: string) {
    const row = this.find(id);
    if (!row) return false;
    this.rows = this.rows.filter((other) => other !== row);
    return true;
  }

  async slotNear(status: TodoStatus, { beforeId, afterId }: TodoAnchors, movingId?: string): Promise<TodoSlot | null> {
    if (movingId !== undefined && (beforeId === movingId || afterId === movingId)) return null;
    const anchor = (id: string | null) => (id === null ? null : this.find(id));
    const before = anchor(beforeId);
    const after = anchor(afterId);
    if ((beforeId !== null && before?.status !== status) || (afterId !== null && after?.status !== status)) {
      return null;
    }

    const familyId = this.family.membership?.familyId;
    const column = this.rows
      .filter((row) => row.familyId === familyId && row.status === status && row.id !== movingId)
      .map((row) => row.position)
      .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (before) return { before: before.position, after: column.find((key) => key > before.position) ?? null };
    if (after) return { before: column.findLast((key) => key < after.position) ?? null, after: after.position };
    return { before: null, after: column[0] ?? null };
  }

  async setPosition(id: string, status: TodoStatus, position: string) {
    const row = this.find(id);
    if (!row) return null;
    this.takeSlot(row.familyId, status, position, row.id);

    const now = new Date().toISOString();
    if (status !== "done") {
      Object.assign(row, { completedAt: null, completedBy: null });
    } else if (row.status !== "done") {
      Object.assign(row, { completedAt: now, completedBy: this.family.caller.userId });
    }
    Object.assign(row, { status, position, updatedAt: now });
    return this.toTodo(row);
  }

  /** The caller's card with this id, or undefined (no family, another family's card, or none). */
  private find(id: string) {
    const familyId = this.family.membership?.familyId;
    return familyId === undefined ? undefined : this.rows.find((row) => row.id === id && row.familyId === familyId);
  }

  private requireFamily() {
    const familyId = this.family.membership?.familyId;
    if (familyId === undefined) throw noFamilyError();
    return familyId;
  }

  private members() {
    return this.family.family?.members ?? [];
  }

  /** Like `todos_guard`: a non-null assignee must be a member of the caller's family. */
  private checkAssignee(memberId: string | null) {
    if (memberId !== null && !this.members().some((member) => member.memberId === memberId)) {
      throw assigneeOutsideFamilyError();
    }
  }

  /** Like the unique `(family_id, status, position)` key, plus `failNextWrite`. */
  private takeSlot(familyId: string, status: TodoStatus, position: string, ownId: string | null) {
    if (this.failNextWrite > 0) {
      this.failNextWrite -= 1;
      throw new PositionTakenError();
    }
    const taken = this.rows.some((row) =>
      row.id !== ownId && row.familyId === familyId && row.status === status && row.position === position);
    if (taken) throw new PositionTakenError();
  }

  private topPosition(familyId: string, status: TodoStatus) {
    const first = this.rows
      .filter((row) => row.familyId === familyId && row.status === status)
      .toSorted(byPosition)[0];
    return positionBetween(null, first?.position ?? null);
  }

  private toTodo({ familyId, assigneeMemberId, ...row }: FakeTodoRow): Todo {
    void familyId;
    return { ...row, assignee: todoAssignee(this.members(), assigneeMemberId) };
  }
}
