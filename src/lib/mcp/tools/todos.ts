import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { getCurrentMember } from "@/lib/family/current-member";
import type { CurrentMember, FamilyMember } from "@/lib/family/repository";
import { CREATE, defineTool, DELETE, READ, UPDATE } from "@/lib/mcp/define-tool";
import { getRepositories } from "@/lib/repositories";
import { filterTodos, type TodoAssigneeFilter } from "@/lib/todos/filters";
import { NO_FAMILY_MESSAGE } from "@/lib/todos/repository";
import { createTodo, listTodos, moveTodo, TODO_NOT_FOUND_MESSAGE } from "@/lib/todos/service";
import { TODO_STATUSES, type Todo } from "@/lib/todos/types";
import { idSchema } from "@/lib/validation/primitives";
import { todoPatchSchema, todoSchema } from "@/lib/validation/todo";

/** A `doneSince` early enough to include every Done card, for `includeOlderDone` and the bottom of a column. */
const ALL_TIME = new Date(0).toISOString();

const status = z.enum(TODO_STATUSES);
const assigneeName = z.string().trim().min(1, "Name a family member, or use \"me\".");
const dueDate = z.string();

/** A card as the tools show it: the assignee by name, without the board's position and bookkeeping. */
function toolTodo(todo: Todo) {
  return {
    id: todo.id,
    title: todo.title,
    status: todo.status,
    assignee: todo.assignee ? todo.assignee.name : null,
    dueDate: todo.dueDate,
    notes: todo.notes,
  };
}

/**
 * The caller's membership, or a refusal for a caller without a family. While the family flag is off
 * `getCurrentMember()` is null too (the tools aren't registered then, so that's only a safety net).
 */
async function requireMember(): Promise<CurrentMember> {
  const member = await getCurrentMember();
  if (!member) throw new DomainError(NO_FAMILY_MESSAGE, 404);
  return member;
}

function memberNames(members: readonly FamilyMember[]) {
  return members.map((member) => member.displayName ?? member.username).filter((name) => name !== null);
}

/**
 * The member id for `name`: "me" is the caller, otherwise a member whose display name or username
 * matches case-insensitively. Unknown or ambiguous names are a field error listing the valid names.
 */
async function resolveAssignee(me: CurrentMember, name: string, field = "assignee"): Promise<string> {
  const wanted = name.trim().toLowerCase();
  if (wanted === "me") return me.memberId;

  const members = (await getRepositories().family.getFamily())?.members ?? [];
  const matches = members.filter((member) =>
    [member.displayName, member.username].some((candidate) => candidate?.trim().toLowerCase() === wanted));
  if (matches.length === 1) return matches[0].memberId;

  const valid = [...memberNames(members).map((member) => `"${member}"`), "\"me\""].join(", ");
  const message = matches.length === 0
    ? `No family member is called "${name}". Use one of: ${valid}.`
    : `More than one family member is called "${name}". Use one of: ${valid}.`;
  throw new DomainError(message, 422, { [field]: [message] });
}

const listSchema = z.object({
  status: status.optional(),
  assignee: z.string().trim().min(1).optional()
    .describe("A member's name, \"me\" or \"unassigned\"; omit for everyone"),
  due: z.enum(["today", "overdue"]).optional(),
  includeOlderDone: z.boolean().default(false).describe("Include Done cards completed more than 30 days ago"),
});

const addSchema = z.object({
  title: z.string(),
  notes: z.string().optional(),
  status: status.optional().describe("Defaults to todo"),
  assignee: assigneeName.optional().describe("A member's name or \"me\"; omit for unassigned"),
  dueDate: dueDate.optional().describe("YYYY-MM-DD"),
});

const moveSchema = z.object({
  id: idSchema(),
  status,
  where: z.enum(["top", "bottom"]).default("top").describe("Where in the column the card goes"),
});

const updateSchema = z.object({
  id: idSchema(),
  title: z.string().optional(),
  notes: z.string().optional(),
  assignee: assigneeName.nullable().optional().describe("A member's name or \"me\"; null to unassign"),
  dueDate: dueDate.nullable().optional().describe("YYYY-MM-DD; null to clear"),
});

const idInput = z.object({ id: idSchema() });

export const todoTools = [
  defineTool({
    name: "list_todos",
    title: "List to-dos",
    description: "Cards on the family to-do board, in board order. Done shows the last 30 days unless includeOlderDone.",
    schema: listSchema,
    annotations: READ,
    run: async ({ status, assignee, due, includeOlderDone }) => {
      const me = await requireMember();
      let assigneeFilter: TodoAssigneeFilter = "all";
      if (assignee !== undefined) {
        const lower = assignee.toLowerCase();
        assigneeFilter = lower === "me" || lower === "unassigned" ? lower : await resolveAssignee(me, assignee);
      }
      const todos = filterTodos(
        await listTodos(includeOlderDone ? ALL_TIME : undefined),
        { assignee: assigneeFilter, due: due ?? "any" },
        me.memberId,
      ).filter((todo) => status === undefined || todo.status === status);
      return { todos: todos.map(toolTodo) };
    },
  }),
  defineTool({
    name: "add_todo",
    title: "Add to-do",
    description: "Add a card at the top of its column on the family board.",
    schema: addSchema,
    annotations: CREATE,
    run: async ({ assignee, ...fields }, { userId }) => {
      const me = await requireMember();
      const assigneeMemberId = assignee === undefined ? null : await resolveAssignee(me, assignee);
      const todo = await createTodo(userId, todoSchema.parse({ ...fields, assigneeMemberId }));
      return { todo: toolTodo(todo) };
    },
  }),
  defineTool({
    name: "move_todo",
    title: "Move to-do",
    description: "Move a card to a column, at its top or bottom.",
    schema: moveSchema,
    annotations: UPDATE,
    run: async ({ id, status, where }) => {
      await requireMember();
      let beforeId: string | null = null;
      if (where === "bottom") {
        // Every card of the column, old Done cards included, so "bottom" really is the bottom.
        const column = (await listTodos(ALL_TIME)).filter((todo) => todo.status === status && todo.id !== id);
        beforeId = column.at(-1)?.id ?? null;
      }
      return { todo: toolTodo(await moveTodo(id, { status, beforeId, afterId: null })) };
    },
  }),
  defineTool({
    name: "update_todo",
    title: "Update to-do",
    description: "Change a card's title, notes, assignee or due date. Use move_todo to change its column.",
    schema: updateSchema,
    annotations: UPDATE,
    notFound: TODO_NOT_FOUND_MESSAGE,
    run: async ({ id, assignee, ...fields }) => {
      const me = await requireMember();
      const patch: Record<string, unknown> = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );
      if (assignee !== undefined) {
        patch.assigneeMemberId = assignee === null ? null : await resolveAssignee(me, assignee);
      }
      const todo = await getRepositories().todos.update(id, todoPatchSchema.parse(patch));
      return todo && { todo: toolTodo(todo) };
    },
  }),
  defineTool({
    name: "delete_todo",
    title: "Delete to-do",
    description: "Permanently delete a card from the family board.",
    schema: idInput,
    annotations: DELETE,
    notFound: TODO_NOT_FOUND_MESSAGE,
    run: async ({ id }) => {
      await requireMember();
      return (await getRepositories().todos.delete(id)) && { deleted: true, id };
    },
  }),
];
