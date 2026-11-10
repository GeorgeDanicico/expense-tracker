import { describe, expect, it, vi } from "vitest";

import { fetchAllPages, type Page } from "@/lib/supabase/fetch-all-pages";

const FAILURE = "Unable to load the list.";

/**
 * A paged table like PostgREST's: `rows()` is what the table holds at the moment of each request,
 * at most `cap` rows come back per request, the exact count comes with every page, and an offset past
 * the last row is refused with PGRST103, as PostgREST does when the count is asked for.
 */
function pagedTable(rows: () => number[], cap = Infinity) {
  const ranges: [number, number][] = [];
  const fetchPage = vi.fn(async (from: number, to: number): Promise<Page<number>> => {
    ranges.push([from, to]);
    const all = rows();
    if (from > 0 && from >= all.length) {
      return { data: null, error: { code: "PGRST103", message: "Requested range not satisfiable" }, count: null };
    }
    return { data: all.slice(from, Math.min(to + 1, from + cap)), error: null, count: all.length };
  });
  return { fetchPage, ranges };
}

const numbers = (count: number) => Array.from({ length: count }, (_, index) => index);

describe("fetchAllPages", () => {
  it("reads a list that fits in one page with one request", async () => {
    const { fetchPage, ranges } = pagedTable(() => numbers(3));

    expect(await fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).toEqual([0, 1, 2]);
    expect(ranges).toEqual([[0, 9]]);
  });

  it("reads an empty list with one request", async () => {
    const { fetchPage, ranges } = pagedTable(() => []);

    expect(await fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).toEqual([]);
    expect(ranges).toEqual([[0, 9]]);
  });

  it("reads every page of a longer list, the last one short", async () => {
    const { fetchPage, ranges } = pagedTable(() => numbers(25));

    expect(await fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).toEqual(numbers(25));
    expect(ranges).toEqual([[0, 9], [10, 19], [20, 29]]);
  });

  it("stops after a full last page, without asking for an empty one", async () => {
    const { fetchPage, ranges } = pagedTable(() => numbers(20));

    expect(await fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).toEqual(numbers(20));
    expect(ranges).toEqual([[0, 9], [10, 19]]);
  });

  it("advances by the rows that came back when the server caps pages below the page size", async () => {
    const { fetchPage, ranges } = pagedTable(() => numbers(7), 3);

    expect(await fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).toEqual(numbers(7));
    expect(ranges).toEqual([[0, 9], [3, 12], [6, 15]]);
  });

  it("starts over when a row is added between two pages, rather than return one twice", async () => {
    let requests = 0;
    // 25 rows for the first page, then a 26th sorts in before them: every row after it moves down one.
    const { fetchPage } = pagedTable(() => (++requests === 1 ? numbers(25) : [-1, ...numbers(25)]));

    expect(await fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).toEqual([-1, ...numbers(25)]);
  });

  it("starts over when rows are deleted between two pages, rather than skip one", async () => {
    let requests = 0;
    // 12 rows, then 11: the second page's total changed.
    const { fetchPage } = pagedTable(() => (++requests === 1 ? numbers(12) : numbers(11)));

    expect(await fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).toEqual(numbers(11));
  });

  it("starts over when PostgREST refuses an offset that deleted rows put past the end (PGRST103), instead of failing", async () => {
    let requests = 0;
    // A full first page of 10 out of 11, then the 11th is deleted: offset 10 is now past the end.
    const { fetchPage } = pagedTable(() => (++requests === 1 ? numbers(11) : numbers(10)));

    expect(await fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).toEqual(numbers(10));
  });

  it("gives up with the failure message when the rows keep changing", async () => {
    let total = 15;
    const { fetchPage } = pagedTable(() => numbers(total++));

    await expect(fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).rejects.toThrow(new Error(FAILURE));
    expect(fetchPage).toHaveBeenCalledTimes(6);
  });

  it("fails the whole read when a page errors, with the failure message", async () => {
    let requests = 0;
    const fetchPage = async (from: number, to: number): Promise<Page<number>> => (++requests === 2
      ? { data: null, error: { code: "57014", message: "private: statement timeout" }, count: null }
      : { data: numbers(25).slice(from, to + 1), error: null, count: 25 });

    await expect(fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).rejects.toThrow(FAILURE);
  });

  it("reads only the first `limit` rows, in pages, when there are more", async () => {
    const { fetchPage, ranges } = pagedTable(() => numbers(5_000));

    expect(await fetchAllPages(fetchPage, FAILURE, { pageSize: 10, limit: 21 })).toEqual(numbers(21));
    expect(ranges).toEqual([[0, 9], [10, 19], [20, 20]]);
  });

  it("reads every row when there are fewer than `limit`", async () => {
    const { fetchPage, ranges } = pagedTable(() => numbers(7));

    expect(await fetchAllPages(fetchPage, FAILURE, { pageSize: 10, limit: 21 })).toEqual(numbers(7));
    expect(ranges).toEqual([[0, 9]]);
  });

  it("fails rather than guess when the query didn't ask for the count", async () => {
    const fetchPage = async (): Promise<Page<number>> => ({ data: numbers(3), error: null, count: null });

    await expect(fetchAllPages(fetchPage, FAILURE, { pageSize: 10 })).rejects.toThrow(new Error(FAILURE));
  });
});
