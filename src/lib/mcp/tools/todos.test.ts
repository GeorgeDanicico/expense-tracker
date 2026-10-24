import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/repositories", () => import("@/test/fakes/repositories"));

import { createMcpServer } from "@/lib/mcp/server";
import { aFamily, aFamilyMember, aKid, aParent } from "@/test/builders";
import { resetFakeRepositories, type FakeRepositories } from "@/test/fakes/repositories";

const PARENT_ID = "60000000-0000-4000-8000-000000000001";
const KID_ID = "60000000-0000-4000-8000-000000000002";
const PARENT_USER = "10000000-0000-4000-8000-000000000001";
const OTHER_FAMILY = "70000000-0000-4000-8000-000000000009";
const MISSING = "8d0f7c2e-4b1a-4c3d-9e5f-1a2b3c4d5e6f";

async function call(name: string, args: Record<string, unknown> = {}) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({ userId: "owner", email: "owner@example.com" });
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0].text;
  return { isError: result.isError, text, body: text.startsWith("{") ? JSON.parse(text) : {} };
}

describe("MCP to-do tools", () => {
  let repositories: FakeRepositories;

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("FAMILY_ENABLED", "true");
    repositories = resetFakeRepositories();
    const family = aFamily();
    family.members.push(aFamilyMember({ displayName: "Ana", username: "ana" }));
    repositories.family.family = family;
    repositories.family.membership = aParent();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const todos = () => repositories.todos;
  const titles = (body: { todos: { title: string }[] }) => body.todos.map((todo) => todo.title);

  describe("list_todos", () => {
    it("lists the family's cards in board order, with the assignee by name", async () => {
      todos().seed({ title: "Second", position: "a1" });
      todos().seed({ title: "First", position: "a0", assigneeMemberId: KID_ID, dueDate: "2026-10-30", notes: "2 litres" });
      todos().seed({ title: "Working", status: "in_progress" });

      const { body, isError } = await call("list_todos");

      expect(isError).toBeFalsy();
      expect(body.todos).toEqual([
        { id: expect.any(String), title: "First", status: "todo", assignee: "Ana", dueDate: "2026-10-30", notes: "2 litres" },
        expect.objectContaining({ title: "Second", assignee: null }),
        expect.objectContaining({ title: "Working", status: "in_progress" }),
      ]);
    });

    it("filters by status, by assignee name (any case), me and unassigned", async () => {
      todos().seed({ title: "Ana's", assigneeMemberId: KID_ID });
      todos().seed({ title: "Mine", assigneeMemberId: PARENT_ID });
      todos().seed({ title: "Nobody's", status: "in_progress" });

      expect(titles((await call("list_todos", { assignee: "ANA" })).body)).toEqual(["Ana's"]);
      expect(titles((await call("list_todos", { assignee: "me" })).body)).toEqual(["Mine"]);
      expect(titles((await call("list_todos", { assignee: "unassigned" })).body)).toEqual(["Nobody's"]);
      expect(titles((await call("list_todos", { status: "in_progress" })).body)).toEqual(["Nobody's"]);
    });

    it("filters by due today and overdue", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-24T10:00:00Z"));
      todos().seed({ title: "Today", dueDate: "2026-10-24" });
      todos().seed({ title: "Late", dueDate: "2026-10-20" });
      todos().seed({ title: "Later", dueDate: "2026-11-01" });

      expect(titles((await call("list_todos", { due: "today" })).body)).toEqual(["Today"]);
      expect(titles((await call("list_todos", { due: "overdue" })).body)).toEqual(["Late"]);
    });

    it("keeps Done to the last 30 days unless includeOlderDone", async () => {
      todos().seed({ title: "Recent", status: "done" });
      todos().seed({ title: "Old", status: "done", completedAt: "2020-01-01T00:00:00.000Z" });

      expect(titles((await call("list_todos")).body)).toEqual(["Recent"]);
      expect(titles((await call("list_todos", { includeOlderDone: true })).body).sort()).toEqual(["Old", "Recent"]);
    });

    it("never shows another family's cards", async () => {
      todos().seed({ title: "Ours" });
      todos().seed({ title: "Theirs", familyId: OTHER_FAMILY });

      expect(titles((await call("list_todos")).body)).toEqual(["Ours"]);
    });

    it("lists the valid names for an unknown assignee", async () => {
      const { body, isError } = await call("list_todos", { assignee: "Bob" });

      expect(isError).toBe(true);
      expect(body.error).toBe("No family member is called \"Bob\". Use one of: \"owner\", \"Ana\", \"me\".");
    });
  });

  describe("add_todo", () => {
    it("adds a card at the top of its column, assigned by name", async () => {
      todos().seed({ title: "Existing" });

      const { body, isError } = await call("add_todo", { title: "Call the plumber", assignee: "ana", dueDate: "2026-10-30", notes: "Before Friday" });

      expect(isError).toBeFalsy();
      expect(body.todo).toEqual({ id: expect.any(String), title: "Call the plumber", status: "todo", assignee: "Ana", dueDate: "2026-10-30", notes: "Before Friday" });
      expect(titles((await call("list_todos")).body)).toEqual(["Call the plumber", "Existing"]);
      expect(todos().rows.find((row) => row.title === "Call the plumber")).toMatchObject({ createdBy: "owner", assigneeMemberId: KID_ID });
    });

    it("assigns to the caller with me, and adds to another column", async () => {
      const { body } = await call("add_todo", { title: "Mine", assignee: "Me", status: "in_progress" });

      expect(body.todo).toMatchObject({ status: "in_progress", assignee: "owner" });
    });

    it("refuses an unknown assignee without adding the card", async () => {
      const { body, isError } = await call("add_todo", { title: "Call", assignee: "Bob" });

      expect(isError).toBe(true);
      expect(body.error).toContain("No family member is called \"Bob\"");
      expect(body.fieldErrors.assignee).toHaveLength(1);
      expect(todos().rows).toEqual([]);
    });

    it("refuses an ambiguous name", async () => {
      repositories.family.family!.members.push(aFamilyMember({ memberId: "60000000-0000-4000-8000-000000000003", displayName: "ana", username: "ana2" }));

      const { body, isError } = await call("add_todo", { title: "Call", assignee: "Ana" });

      expect(isError).toBe(true);
      expect(body.error).toContain("More than one family member is called \"Ana\"");
    });

    it("reports an invalid title and due date as field errors", async () => {
      const { body, isError } = await call("add_todo", { title: " ", dueDate: "2026-02-30" });

      expect(isError).toBe(true);
      expect(Object.keys(body.fieldErrors).sort()).toEqual(["dueDate", "title"]);
    });
  });

  describe("move_todo", () => {
    it("moves a card to the top of a column", async () => {
      todos().seed({ title: "Already working", status: "in_progress" });
      const card = todos().seed({ title: "Start me" });

      const { body, isError } = await call("move_todo", { id: card.id, status: "in_progress" });

      expect(isError).toBeFalsy();
      expect(body.todo).toMatchObject({ id: card.id, status: "in_progress" });
      expect(titles((await call("list_todos", { status: "in_progress" })).body)).toEqual(["Start me", "Already working"]);
    });

    it("moves a card to the bottom of a column, below older Done cards too", async () => {
      todos().seed({ title: "Recent", status: "done", position: "a0" });
      todos().seed({ title: "Old", status: "done", position: "a1", completedAt: "2020-01-01T00:00:00.000Z" });
      const card = todos().seed({ title: "Finish me" });

      await call("move_todo", { id: card.id, status: "done", where: "bottom" });

      expect(titles((await call("list_todos", { status: "done", includeOlderDone: true })).body)).toEqual(["Recent", "Old", "Finish me"]);
    });

    it("moves the last card of its own column to the bottom", async () => {
      todos().seed({ title: "Top", position: "a0" });
      const card = todos().seed({ title: "Bottom", position: "a1" });

      const { isError } = await call("move_todo", { id: card.id, status: "todo", where: "bottom" });

      expect(isError).toBeFalsy();
      expect(titles((await call("list_todos")).body)).toEqual(["Top", "Bottom"]);
    });
  });

  describe("update_todo", () => {
    it("changes the title, notes, assignee and due date", async () => {
      const card = todos().seed({ title: "Old title" });

      const { body, isError } = await call("update_todo", { id: card.id, title: "New title", notes: "Notes", assignee: "Ana", dueDate: "2026-11-01" });

      expect(isError).toBeFalsy();
      expect(body.todo).toMatchObject({ title: "New title", notes: "Notes", assignee: "Ana", dueDate: "2026-11-01" });
    });

    it("clears the assignee and due date with null", async () => {
      const card = todos().seed({ assigneeMemberId: KID_ID, dueDate: "2026-11-01" });

      const { body } = await call("update_todo", { id: card.id, assignee: null, dueDate: null });

      expect(body.todo).toMatchObject({ assignee: null, dueDate: null });
    });

    it("asks for at least one change", async () => {
      const card = todos().seed();

      const { body, isError } = await call("update_todo", { id: card.id });

      expect(isError).toBe(true);
      expect(body.error).toBe("Change at least one field.");
    });

    it("lets a kid edit a card a parent created and assigned", async () => {
      repositories.family.membership = aKid();
      const card = todos().seed({ title: "Parent's", createdBy: PARENT_USER, assigneeMemberId: PARENT_ID });

      const { body, isError } = await call("update_todo", { id: card.id, notes: "Done by Ana", assignee: "me" });

      expect(isError).toBeFalsy();
      expect(body.todo).toMatchObject({ notes: "Done by Ana", assignee: "Ana" });
    });
  });

  describe("delete_todo", () => {
    it("deletes a card", async () => {
      const card = todos().seed();

      const { body, isError } = await call("delete_todo", { id: card.id });

      expect(isError).toBeFalsy();
      expect(body).toEqual({ deleted: true, id: card.id });
      expect(todos().rows).toEqual([]);
    });

    it("reports a missing card", async () => {
      const { body, isError } = await call("delete_todo", { id: MISSING });

      expect(isError).toBe(true);
      expect(body.error).toBe("To-do not found.");
    });
  });

  it.each([
    ["move_todo", (id: string) => ({ id, status: "done" })],
    ["update_todo", (id: string) => ({ id, title: "Mine now" })],
    ["delete_todo", (id: string) => ({ id })],
  ])("treats another family's card as not found in %s, leaving it alone", async (name, args) => {
    const theirs = todos().seed({ title: "Theirs", familyId: OTHER_FAMILY });
    const before = { ...theirs };

    const { body, isError } = await call(name, args(theirs.id));

    expect(isError).toBe(true);
    expect(body.error).toBe("To-do not found.");
    expect(todos().rows).toEqual([before]);
  });

  it.each([
    ["list_todos", {}],
    ["add_todo", { title: "Milk" }],
    ["move_todo", { id: MISSING, status: "done" }],
    ["update_todo", { id: MISSING, title: "Milk" }],
    ["delete_todo", { id: MISSING }],
  ])("refuses %s for a caller without a family", async (name, args) => {
    repositories.family.membership = null;
    repositories.family.family = null;

    const { body, isError } = await call(name, args);

    expect(isError).toBe(true);
    expect(body.error).toBe("Join a family to use the to-do board.");
  });
});
