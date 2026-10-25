import { ChakraProvider } from "@chakra-ui/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SWRConfig } from "swr";
import { describe, expect, it } from "vitest";

import { formatDueDate } from "@/components/todos/todo-card";
import { focusAfterLeaving, moveToTop, TodoBoard } from "@/components/todos/todo-board";
import { TodoFilterChips } from "@/components/todos/todo-filters";
import { NoFamilyBoard } from "@/components/todos/todo-board-screen";
import { todoChanges } from "@/components/todos/todo-dialog";
import { useLinkedCard } from "@/components/todos/use-linked-card";
import { doneSinceForStep, OLDER_DONE_STEPS } from "@/components/todos/use-todo-board";
import { ledgerSystem } from "@/components/ui/theme";
import type { FamilyMember } from "@/lib/family/repository";
import { DEFAULT_TODO_FILTERS, linkedCard, withoutCardHref, type TodoFilters } from "@/lib/todos/filters";
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
  function render(todos: Todo[], singleColumn = false) {
    return renderToStaticMarkup(
      <ChakraProvider value={ledgerSystem}>
        <SWRConfig value={{ fetcher: () => new Promise(() => {}) }}>
          <TodoBoard todos={todos} onAdd={async () => {}} onMove={async () => {}} onOpen={() => {}} singleColumn={singleColumn} />
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

  it("counts only the cards it is given, so a filtered view counts what it shows", () => {
    const html = render([card({ id: "a" })]);
    expect(html).toContain('aria-label="1 card"');
    expect(html).not.toContain('aria-label="2 cards"');
  });

  it("has no Move to… menu on the desktop board", () => {
    expect(render([card({})])).not.toContain("Move Buy milk to…");
  });

  it("shows one column behind the column switcher on a phone, with Move to… on each card", () => {
    const html = render([card({}), card({ id: "p", title: "Painting", status: "in_progress" })], true);
    expect(html).toContain('aria-label="Column"');
    expect(html).toContain('id="todo-column-todo"');
    expect(html).not.toContain('id="todo-column-in_progress"');
    expect(html).not.toContain("Painting");
    expect(html).toContain('aria-label="Move Buy milk to…"');
  });
});

describe("focusAfterLeaving", () => {
  it("picks the card below, the one above when it was last, and nothing when it was alone", () => {
    expect(focusAfterLeaving(["a", "b", "c"], "b")).toBe("c");
    expect(focusAfterLeaving(["a", "b", "c"], "c")).toBe("b");
    expect(focusAfterLeaving(["a"], "a")).toBeNull();
    expect(focusAfterLeaving(["a"], "x")).toBeNull();
  });
});

describe("moveToTop", () => {
  it("anchors on nothing, so the server puts the card at the top of the column", () => {
    expect(moveToTop("done")).toEqual({ status: "done", beforeId: null, afterId: null });
  });
});

describe("TodoFilterChips", () => {
  const member = (memberId: string, displayName: string): FamilyMember => ({
    memberId, userId: `u-${memberId}`, role: "parent", isCreator: false, displayName, username: null,
    currency: "EUR", color: null, avatarUrl: null, joinedAt: "2026-01-01T00:00:00Z",
  } as FamilyMember);

  function render(filters: TodoFilters) {
    return renderToStaticMarkup(
      <ChakraProvider value={ledgerSystem}>
        <TodoFilterChips
          filters={filters}
          members={[member("m-me", "George"), member("m-ana", "Ana")]}
          myMemberId="m-me"
          colorOf={() => undefined}
          onChange={() => {}}
        />
      </ChakraProvider>,
    );
  }
  // Each pressed chip's label: the text after its icon or avatar (whose initials come first).
  const pressed = (html: string) => [...html.matchAll(/<button[^>]*aria-pressed="true"[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => match[1].split(/<[^>]*>/).filter(Boolean).at(-1));

  it("offers Everyone, Me, the other members, Unassigned and the due chips, without the caller twice", () => {
    const html = render(DEFAULT_TODO_FILTERS);
    for (const label of ["Everyone", "Me", "Ana", "Unassigned", "Due today", "Overdue"]) expect(html).toContain(`>${label}<`);
    expect(html).not.toContain(">George<");
    expect(pressed(html)).toEqual(["Everyone"]);
  });

  it("presses the assignee chip and the due chip together", () => {
    expect(pressed(render({ assignee: "m-ana", due: "overdue" }))).toEqual(["Ana", "Overdue"]);
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

describe("the board with ?card=<id>", () => {
  const cards = [card({ id: "8f0c2e4a-0000-4000-8000-000000000001", title: "Buy milk" }), card({ id: "t2", title: "Fix the tap" })];

  /** The card id the board's dialog shows on its first render, or "none". */
  function Probe({ todos, cardParam }: { todos?: Todo[]; cardParam: string | null }) {
    const { openId } = useLinkedCard(todos, cardParam, "/todos");
    return <output>{openId ?? "none"}</output>;
  }
  const opened = (todos: Todo[] | undefined, cardParam: string | null) =>
    renderToStaticMarkup(<Probe todos={todos} cardParam={cardParam} />).replace(/<\/?output>/g, "");

  it("opens the named card's dialog once the board has loaded", () => {
    expect(opened(cards, "t2")).toBe("t2");
    // Any case, as a UUID can be written either way.
    expect(opened(cards, "8F0C2E4A-0000-4000-8000-000000000001")).toBe(cards[0].id);
  });

  it("opens nothing for an unknown id, no param, or before the board loads", () => {
    expect(opened(cards, "gone")).toBe("none");
    expect(opened(cards, "")).toBe("none");
    expect(opened(cards, null)).toBe("none");
    expect(opened(undefined, "t2")).toBe("none");
  });

  it("finds the card whatever the filters hide", () => {
    expect(linkedCard("t2", cards)?.title).toBe("Fix the tap");
    expect(linkedCard(" t2 ", cards)?.title).toBe("Fix the tap");
    expect(linkedCard("t3", cards)).toBeNull();
  });

  it("drops only ?card= from the URL when the dialog closes", () => {
    expect(withoutCardHref("/todos", "?card=t2")).toBe("/todos");
    expect(withoutCardHref("/todos", "?member=me&card=t2&due=today")).toBe("/todos?member=me&due=today");
    expect(withoutCardHref("/todos", "")).toBe("/todos");
  });
});
