import type { TodoApi } from "@/components/todos/todo-api";
import { ApiError } from "@/lib/api/client";
import { addDays, getBucharestToday } from "@/lib/calendar";
import { applyMove, groupTodos } from "@/lib/todos/board";
import { positionBetween } from "@/lib/todos/position";
import type { Todo, TodoAssignee, TodoStatus } from "@/lib/todos/types";

// The family board for `/dev/preview/todos`: sample cards kept in memory, and a fake API that
// changes them the way the real routes would, so dragging, adding and editing work without a
// session. Open `/dev/preview/todos?failMoves=1` to have every move refused with a 409.

const MEMBERS: Record<string, TodoAssignee> = {
  "m-george": { memberId: "m-george", name: "George", color: null, avatarUrl: null },
  "m-maria": { memberId: "m-maria", name: "Maria", color: 6, avatarUrl: "/apple-icon.png" },
  "m-ana": { memberId: "m-ana", name: "Ana", color: null, avatarUrl: null },
  "m-luca": { memberId: "m-luca", name: "Luca", color: null, avatarUrl: null },
};

type Sample = [title: string, assignee: string | null, dueInDays: number | null, notes?: string];

const SAMPLES: Record<TodoStatus, Sample[]> = {
  todo: [
    ["Buy milk", "m-george", 0],
    ["Book the dentist for Ana", "m-maria", -2, "Dr. Ionescu, after 4 pm if possible."],
    ["Renew the car insurance", "m-george", 12],
    ["Pack the swimming bag", "m-luca", null],
    ["Call grandma", null, null],
  ],
  in_progress: [
    ["Clean out the garage", "m-george", 3],
    ["Science project: volcano", "m-ana", 5, "Needs baking soda and vinegar."],
  ],
  done: [
    ["Pay the electricity bill", "m-maria", -1],
    ["Return the library books", "m-ana", null],
  ],
};

let store: Todo[] | null = null;
let counter = 0;

function seed(): Todo[] {
  const today = getBucharestToday();
  const now = new Date().toISOString();
  return (Object.entries(SAMPLES) as [TodoStatus, Sample[]][]).flatMap(([status, samples]) => {
    let previous: string | null = null;
    return samples.map(([title, assignee, dueInDays, notes = ""], index) => {
      previous = positionBetween(previous, null);
      return {
        id: `todo-${status}-${index}`,
        title,
        notes,
        status,
        position: previous,
        assignee: assignee ? MEMBERS[assignee] : null,
        dueDate: dueInDays === null ? null : addDays(today, dueInDays),
        createdBy: "u-m-george",
        createdAt: now,
        updatedAt: now,
        completedAt: status === "done" ? now : null,
        completedBy: status === "done" ? "u-m-george" : null,
      };
    });
  });
}

function todos(): Todo[] {
  store ??= seed();
  return store;
}

/** `GET /api/todos` in the preview. */
export function previewTodos(): { todos: Todo[] } {
  return { todos: todos() };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function replace(todo: Todo) {
  store = todos().map((item) => (item.id === todo.id ? todo : item));
  return todo;
}

function find(id: string) {
  const todo = todos().find((item) => item.id === id);
  if (!todo) throw new ApiError("To-do not found.", 404);
  return todo;
}

export const previewTodoApi: TodoApi = {
  async create({ title, status, assigneeMemberId = null, dueDate = null }) {
    await delay(250);
    const first = groupTodos(todos())[status][0];
    const now = new Date().toISOString();
    const todo: Todo = {
      id: `todo-new-${++counter}`, title, notes: "", status,
      position: positionBetween(null, first?.position ?? null),
      assignee: assigneeMemberId ? MEMBERS[assigneeMemberId] ?? null : null, dueDate, createdBy: "u-m-george", createdAt: now, updatedAt: now,
      completedAt: status === "done" ? now : null, completedBy: status === "done" ? "u-m-george" : null,
    };
    store = [...todos(), todo];
    return todo;
  },
  async update(id, changes) {
    await delay(250);
    const todo = find(id);
    const { assigneeMemberId, ...rest } = changes;
    return replace({
      ...todo,
      ...rest,
      ...(assigneeMemberId === undefined ? {} : { assignee: assigneeMemberId ? MEMBERS[assigneeMemberId] ?? null : null }),
      updatedAt: new Date().toISOString(),
    });
  },
  async remove(id) {
    await delay(250);
    find(id);
    store = todos().filter((todo) => todo.id !== id);
  },
  async move(id, move) {
    await delay(600);
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("failMoves")) {
      throw new ApiError("The board changed. Refresh it and try again.", 409);
    }
    const before = find(id);
    const moved = applyMove(todos(), id, move).find((todo) => todo.id === id);
    if (!moved || (moved.status === before.status && moved.position === before.position)) {
      throw new ApiError("The board changed. Refresh it and try again.", 409);
    }
    const now = new Date().toISOString();
    const entering = moved.status === "done" && before.status !== "done";
    return replace({
      ...moved,
      updatedAt: now,
      completedAt: moved.status !== "done" ? null : entering ? now : before.completedAt,
      completedBy: moved.status !== "done" ? null : entering ? "u-m-george" : before.completedBy,
    });
  },
};
