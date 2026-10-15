import { describe, expect, it } from "vitest";

import { fakeSupabase } from "./fake-supabase";

const people = () => [
  { id: "a", name: "Ana", born: "1990-01-01", team: "red", deleted_at: null },
  { id: "b", name: "Bob", born: "2000-06-15", team: "blue", deleted_at: null },
  { id: "c", name: "Cat", born: "2010-12-31", team: "red", deleted_at: "2026-01-01" },
];

describe("fakeSupabase", () => {
  it("applies eq, is, gte, lt and or filters together", async () => {
    const { client } = fakeSupabase({ people: people() });

    const { data } = await client.from("people").select().eq("team", "red").is("deleted_at", null)
      .gte("born", "1990-01-01").lt("born", "2011-01-01").or("id.in.(a,c),name.in.(Bob)");

    expect(data?.map((row) => row.id)).toEqual(["a"]);
  });

  it("orders by each column in turn and honours descending order", async () => {
    const { client } = fakeSupabase({ people: people() });

    const { data } = await client.from("people").select().order("team").order("born", { ascending: false });

    expect(data?.map((row) => row.id)).toEqual(["b", "c", "a"]);
  });

  it("returns at most the limit", async () => {
    const { client, queries } = fakeSupabase({ people: people() });

    const { data } = await client.from("people").select().order("id").limit(2);

    expect(data?.map((row) => row.id)).toEqual(["a", "b"]);
    expect(queries[0]).toMatchObject({ limits: ["2"] });
  });

  it("filters, orders and limits an embedded list, dropping rows whose list no longer matches", async () => {
    const teams = [
      { id: "red", people: people().filter((person) => person.team === "red") },
      { id: "blue", people: people().filter((person) => person.team === "blue") },
      { id: "green", people: [{ id: "d", born: "1980-01-01" }] },
    ];
    const { client, queries } = fakeSupabase({ teams });

    const { data } = await client.from("teams").select().gte("people.born", "1985-01-01")
      .order("born", { foreignTable: "people", ascending: false }).limit(1, { foreignTable: "people" });

    expect(data).toEqual([
      { id: "red", people: [expect.objectContaining({ id: "c" })] },
      { id: "blue", people: [expect.objectContaining({ id: "b" })] },
    ]);
    expect(queries[0]).toMatchObject({ orders: ["people.born"], limits: ["people:1"] });
    expect(teams[0].people).toHaveLength(2);
  });

  it("filters on a column of an embedded row", async () => {
    const { client } = fakeSupabase({ pets: [{ id: "rex", owner: { team: "red" } }, { id: "tom", owner: { team: "blue" } }] });

    const { data } = await client.from("pets").select().eq("owner.team", "blue");

    expect(data?.map((row) => row.id)).toEqual(["tom"]);
  });

  it("returns a range page no larger than the page cap, with the full count", async () => {
    const { client } = fakeSupabase({ people: people() }, { pageCap: 1 });

    const page = await client.from("people").select().order("id").range(1, 2);

    expect(page).toEqual({ data: [expect.objectContaining({ id: "b" })], error: null, count: 3 });
  });

  it("records each finished query with its operation, filters and orders", async () => {
    const { client, queries } = fakeSupabase({ people: people() });

    await client.from("people").select().eq("id", "a").order("born").maybeSingle();

    expect(queries).toEqual([
      { table: "people", operation: "select", filters: [["eq", "id", "a"]], orders: ["born"] },
    ]);
  });

  it("inserts a row through the trigger and returns it from single", async () => {
    const { client, tables } = fakeSupabase({}, { trigger: (row) => ({ ...row, created_at: "now" }) });

    const { data } = await client.from("people").insert({ name: "Dan" }).select().single();

    expect(data).toEqual({ id: "row-1", name: "Dan", created_at: "now" });
    expect(tables.people).toEqual([data]);
  });

  it("updates only the matching rows", async () => {
    const { client, tables } = fakeSupabase({ people: people() });

    const { data } = await client.from("people").update({ team: "green" }).eq("id", "b").select().maybeSingle();

    expect(data).toMatchObject({ id: "b", team: "green" });
    expect(tables.people.map((row) => row.team)).toEqual(["red", "green", "red"]);
  });

  it("upserts by merging into the row that matches on the conflict column", async () => {
    const { client, tables } = fakeSupabase({ people: people() });

    await client.from("people").upsert({ id: "b", team: "green" }, { onConflict: "id" });

    expect(tables.people[1]).toEqual({ ...people()[1], team: "green" });
    expect(tables.people).toHaveLength(3);
  });

  it("upserts by inserting when no row matches on the conflict column", async () => {
    const { client, tables } = fakeSupabase({ people: people() });

    await client.from("people").upsert({ id: "d", name: "Dan" }, { onConflict: "id" });

    expect(tables.people.map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("deletes only the matching rows and returns them", async () => {
    const { client, tables } = fakeSupabase({ people: people() });

    const { data } = await client.from("people").delete().eq("team", "red").select("id");

    expect(data?.map((row) => row.id)).toEqual(["a", "c"]);
    expect(tables.people.map((row) => row.id)).toEqual(["b"]);
  });

  it("returns null from maybeSingle when nothing matches", async () => {
    const { client } = fakeSupabase({ people: people() });

    expect(await client.from("people").select().eq("id", "missing").maybeSingle()).toEqual({ data: null, error: null });
  });

  it("fails only the queries the fail option selects", async () => {
    const { client } = fakeSupabase({ people: people() }, { fail: (_query, index) => index === 1 });

    const first = await client.from("people").select();
    const second = await client.from("people").select();

    expect(first.error).toBeNull();
    expect(second).toEqual({ data: null, error: { message: "private database failure" }, count: null });
  });
});
