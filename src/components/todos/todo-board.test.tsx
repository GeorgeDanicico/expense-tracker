import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";

import { formatDueDate } from "@/components/todos/todo-card";
import { TodoBoard } from "@/components/todos/todo-board";
import { NoFamilyBoard } from "@/components/todos/todo-board-screen";
import { todoChanges } from "@/components/todos/todo-dialog";
import { doneSinceForStep, OLDER_DONE_STEPS } from "@/components/todos/use-todo-board";
import { ledgerSystem } from "@/components/ui/theme";
import type { Todo } from "@/lib/todos/types";

const NOW = new Date("2026-10-24T09:00:00Z");

function card(overrides: Partial<Todo>): Todo {
  return {
    id: "t1", title: "Buy milk", notes: "", status: "todo", position: "a0", assignee: null, dueDate: null,
    createdBy: null, createdAt: "", updatedAt: "", completedAt: null, completedBy: null,
    ...overrides,
  };
}

describe("doneSinceForStep", () => {
  it("reaches further back with each Show older, then everything", () => {
    expect(doneSinceForStep(0, NOW.getTime())).toBeNull();
    expect(doneSinceForStep(1, NOW.getTime())).toBe("2026-07-26T09:00:00.000Z");
    expect(doneSinceForStep(2, NOW.getTime())).toBe("2025-10-24T09:00:00.000Z");
    expect(doneSinceForStep(OLDER_DONE_STEPS.length + 1, NOW.getTime())).toBe("1970-01-01T00:00:00.000Z");
  });
});

describe("formatDueDate", () => {
  it("leaves out the year for this year", () => {
    expect(formatDueDate("2026-11-03", NOW)).toBe("Nov 3");
    expect(formatDueDate("2027-01-15", NOW)).toBe("Jan 15, 2027");
  });
});

describe("todoChanges", () => {
  const todo = card({ notes: "Semi-skimmed", assignee: { memberId: "m1", name: "Ana", color: null, avatarUrl: null }, dueDate: "2026-10-30" });
  const same = { title: "Buy milk", notes: "Semi-skimmed", assigneeMemberId: "m1", dueDate: "2026-10-30" };

  it("is empty when nothing changed (trimming first)", () => {
    expect(todoChanges(todo, { ...same, title: "  Buy milk " })).toEqual({});
  });

  it("sends only the changed fields, with cleared ones as null", () => {
    expect(todoChanges(todo, { ...same, assigneeMemberId: "", dueDate: "" })).toEqual({ assigneeMemberId: null, dueDate: null });
    expect(todoChanges(todo, { ...same, title: "Buy oat milk", notes: "" })).toEqual({ title: "Buy oat milk", notes: "" });
  });
});

describe("TodoBoard", () => {
  function render(todos: Todo[]) {
    return renderToStaticMarkup(
      <ChakraProvider value={ledgerSystem}>
        <SWRConfig value={{ fetcher: () => new Promise(() => {}) }}>
          <TodoBoard todos={todos} onAdd={async () => {}} onMove={async () => {}} onOpen={() => {}} />
        </SWRConfig>
      </ChakraProvider>,
    );
  }

  it("shows the three columns with their counts and cards in position order", () => {
    const html = render([
      card({ id: "b", title: "Second", position: "a1" }),
      card({ id: "a", title: "First", position: "a0" }),
      card({ id: "d", title: "Finished", status: "done" }),
    ]);
    expect(html.indexOf("To do")).toBeLessThan(html.indexOf("In progress"));
    expect(html.indexOf("In progress")).toBeLessThan(html.indexOf("Done"));
    expect(html).toContain('aria-label="2 cards"');
    expect(html).toContain('aria-label="0 cards"');
    expect(html).toContain('aria-label="1 card"');
    expect(html.indexOf("First")).toBeLessThan(html.indexOf("Second"));
  });

  it("marks an overdue card for screen readers", () => {
    const html = render([card({ dueDate: "2020-01-01" })]);
    expect(html).toContain("Overdue, due");
  });
});

describe("NoFamilyBoard", () => {
  it("points a user without a family to Settings → Family", () => {
    const html = renderToStaticMarkup(
      <ChakraProvider value={ledgerSystem}>
        <NoFamilyBoard />
      </ChakraProvider>,
    );
    expect(html).toContain('href="/settings/family"');
  });
});
