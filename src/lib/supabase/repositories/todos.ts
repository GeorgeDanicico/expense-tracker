import "server-only";

import type { Database } from "@/lib/database.types";
import type { FamilyMember } from "@/lib/family/repository";
import { isUserFacing, translateDatabaseError, type DatabaseError } from "@/lib/supabase/errors";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import { supabaseFamilyRepository } from "@/lib/supabase/repositories/family";
import { createClient } from "@/lib/supabase/server";
import { positionBetween } from "@/lib/todos/position";
import {
  PositionTakenError,
  assigneeOutsideFamilyError,
  noFamilyError,
  todoAssignee,
  type TodoRepository,
} from "@/lib/todos/repository";
import { TODO_STATUSES, type Todo, type TodoStatus } from "@/lib/todos/types";
import type { TodoPatch } from "@/lib/validation/todo";

const LOAD_ERROR = "Unable to load the to-do board.";
const SAVE_ERROR = "Unable to save the to-do.";
const MOVE_ERROR = "Unable to move the to-do.";
const DELETE_ERROR = "Unable to delete the to-do.";

const TODO_COLUMNS =
  "id, title, notes, status, position, assignee_member_id, due_date, created_by, created_at, updated_at, completed_at, completed_by";

type TodoRow = Omit<Database["public"]["Tables"]["todos"]["Row"], "family_id">;

function toStatus(value: string): TodoStatus {
  if ((TODO_STATUSES as readonly string[]).includes(value)) return value as TodoStatus;
  throw new Error(LOAD_ERROR);
}

function toTodo(row: TodoRow, members: readonly FamilyMember[]): Todo {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    status: toStatus(row.status),
    position: row.position,
    assignee: todoAssignee(members, row.assignee_member_id),
    dueDate: row.due_date,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
  };
}

/** Board order: by status as `TODO_STATUSES` lists them, then by key, compared byte by byte like collate "C". */
function compareTodos(a: Todo, b: Todo): number {
  const byStatus = TODO_STATUSES.indexOf(a.status) - TODO_STATUSES.indexOf(b.status);
  if (byStatus) return byStatus;
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/**
 * A failed write on `todos`, through `translateDatabaseError`, with two domain errors of its own:
 * - 23505: the only unique key besides the id is `(family_id, status, position)`, so a racing write
 *   took the slot → `PositionTakenError` (a 409 the service retries).
 * - 23514 marked user-facing, which only `todos_guard` raises: the assignee isn't in the card's
 *   family → a 422 with our own message on `assigneeMemberId`. A table check constraint (title,
 *   notes, status) raises 23514 without the marker, so it gets the generic 422.
 */
export function translateTodoWriteError(error: DatabaseError, fallback: string): Error {
  if (error.code === "23505") return new PositionTakenError();
  if (error.code === "23514" && isUserFacing(error)) return assigneeOutsideFamilyError();
  return translateDatabaseError(error, fallback);
}

/** The patch's fields as columns; absent fields stay as they are. */
function patchValues(patch: TodoPatch) {
  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.assigneeMemberId !== undefined ? { assignee_member_id: patch.assigneeMemberId } : {}),
    ...(patch.dueDate !== undefined ? { due_date: patch.dueDate } : {}),
  };
}

/** The caller's family members, for the assignee display fields; empty without a family. */
async function familyMembers(): Promise<FamilyMember[]> {
  return (await supabaseFamilyRepository.getFamily())?.members ?? [];
}

/**
 * `TodoRepository` on the `todos` table, acting as the request's caller. RLS limits every row to the
 * caller's family, which is the only rule, so queries don't filter by family themselves (except to
 * find the top of a column for a new card, which needs the family id anyway). The assignee names,
 * colours and avatars come from `get_family()`, read once per request however many methods ask (in
 * parallel with the first one's own query), never once per card.
 */
export const supabaseTodoRepository: TodoRepository = {
  async list({ doneSince }) {
    const supabase = await createClient();
    // Two queries rather than one `or` across status and completed_at: PostgREST's `or` would need the
    // timestamp quoted, and two indexed range reads are as cheap. Each reads every page, so a board
    // past the server's row cap is never cut short; `id` last makes the order total, as paging needs.
    const [family, open, done] = await Promise.all([
      supabaseFamilyRepository.getFamily(),
      fetchAllPages((from, to) => supabase.from("todos").select(TODO_COLUMNS, { count: "exact" })
        .or("status.in.(todo,in_progress)").order("position").order("id").range(from, to), LOAD_ERROR),
      fetchAllPages((from, to) => supabase.from("todos").select(TODO_COLUMNS, { count: "exact" })
        .eq("status", "done").gte("completed_at", doneSince).order("position").order("id").range(from, to), LOAD_ERROR),
    ]);
    if (!family) throw noFamilyError();
    return [...open, ...done].map((row) => toTodo(row, family.members)).sort(compareTodos);
  },

  async get(id) {
    const supabase = await createClient();
    const [members, { data, error }] = await Promise.all([
      familyMembers(),
      supabase.from("todos").select(TODO_COLUMNS).eq("id", id).maybeSingle(),
    ]);
    if (error) throw translateDatabaseError(error, LOAD_ERROR);
    return data ? toTodo(data, members) : null;
  },

  /** The family comes from the caller's membership and the creator from `userId`, never from the input. */
  async create(userId, input) {
    const family = await supabaseFamilyRepository.getFamily();
    if (!family) throw noFamilyError();

    const supabase = await createClient();
    const { data: top, error: topError } = await supabase.from("todos").select("position")
      .eq("family_id", family.family.id).eq("status", input.status).order("position").limit(1).maybeSingle();
    if (topError) throw translateDatabaseError(topError, SAVE_ERROR);

    const { data, error } = await supabase.from("todos").insert({
      family_id: family.family.id,
      created_by: userId,
      title: input.title,
      notes: input.notes,
      status: input.status,
      position: positionBetween(null, top?.position ?? null),
      assignee_member_id: input.assigneeMemberId,
      due_date: input.dueDate,
    }).select(TODO_COLUMNS).single();
    if (error) throw translateTodoWriteError(error, SAVE_ERROR);
    return toTodo(data, family.members);
  },

  async update(id, patch) {
    const values = patchValues(patch);
    if (Object.keys(values).length === 0) return supabaseTodoRepository.get(id);

    const supabase = await createClient();
    const [members, { data, error }] = await Promise.all([
      familyMembers(),
      supabase.from("todos").update(values).eq("id", id).select(TODO_COLUMNS).maybeSingle(),
    ]);
    if (error) throw translateTodoWriteError(error, SAVE_ERROR);
    return data ? toTodo(data, members) : null;
  },

  async delete(id) {
    const supabase = await createClient();
    const { data, error } = await supabase.from("todos").delete().eq("id", id).select("id").maybeSingle();
    if (error) throw translateDatabaseError(error, DELETE_ERROR);
    return data !== null;
  },

  async slotNear(status, { beforeId, afterId }, movingId) {
    if (movingId !== undefined && (beforeId === movingId || afterId === movingId)) return null;

    const supabase = await createClient();
    const anchor = async (id: string | null) => {
      if (id === null) return { found: true, position: null };
      const { data, error } = await supabase.from("todos").select("position")
        .eq("id", id).eq("status", status).maybeSingle();
      if (error) throw translateDatabaseError(error, MOVE_ERROR);
      return { found: data !== null, position: data?.position ?? null };
    };
    const [before, after] = await Promise.all([anchor(beforeId), anchor(afterId)]);
    if (!before.found || !after.found) return null;

    // The keys next to the anchor, nearest first. Keys are unique in a column, so after leaving out
    // the anchor itself and the moving card, the first remaining row is the actual neighbour.
    const nearest = async (query: PromiseLike<{ data: { id: string; position: string }[] | null; error: DatabaseError | null }>) => {
      const { data, error } = await query;
      if (error) throw translateDatabaseError(error, MOVE_ERROR);
      if (!data) throw new Error(MOVE_ERROR);
      return data.find((row) => row.id !== beforeId && row.id !== movingId)?.position ?? null;
    };
    const column = () => supabase.from("todos").select("id, position").eq("status", status);

    if (before.position !== null) {
      // Directly below `before`: from its key down, it, maybe the moving card, then the next card.
      const next = await nearest(column().gte("position", before.position).order("position").limit(3));
      return { before: before.position, after: next };
    }
    if (after.position !== null) {
      // Directly above `after`: the cards above it, nearest first, maybe the moving card, then the previous one.
      const previous = await nearest(column().lt("position", after.position).order("position", { ascending: false }).limit(2));
      return { before: previous, after: after.position };
    }
    // The top of the column, as `create` places a card.
    const first = await nearest(column().order("position").limit(2));
    return { before: null, after: first };
  },

  async setPosition(id, status, position) {
    const supabase = await createClient();
    const [members, { data, error }] = await Promise.all([
      familyMembers(),
      supabase.from("todos").update({ status, position }).eq("id", id).select(TODO_COLUMNS).maybeSingle(),
    ]);
    if (error) throw translateTodoWriteError(error, MOVE_ERROR);
    return data ? toTodo(data, members) : null;
  },
};
