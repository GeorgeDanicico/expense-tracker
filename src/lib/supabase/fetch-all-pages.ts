import "server-only";

import { translateDatabaseError, type DatabaseError } from "@/lib/supabase/errors";

/** Rows per request: PostgREST's usual `max-rows`. A smaller server cap still works, it only takes more requests. */
export const PAGE_SIZE = 1000;

/** How many times a read starts over when the rows change between its pages. */
const ATTEMPTS = 3;

/** PostgREST's answer to an offset past the last row ("Requested range not satisfiable", HTTP 416). */
const RANGE_NOT_SATISFIABLE = "PGRST103";

export type Page<Row> = { data: Row[] | null; error: DatabaseError | null; count: number | null };

/**
 * Every row a query matches, for a list that must be complete (audit D7). `fetchPage(from, to)` runs
 * the query for rows `from` to `to` (both included): it must ask for `count: "exact"` and order by
 * columns that end in a unique one, so the pages don't overlap. One request when everything fits in
 * a page, which is the usual case.
 *
 * It advances by the rows each page actually returned, so a server cap below `pageSize` can't cut
 * the list short. When the rows change between two pages (the total moves, or PostgREST refuses an
 * offset that is now past the end), it starts over, up to three times, rather than return a list
 * with a row missing or twice; after that it throws `failure`, as it does for any database error.
 *
 * With `limit`, it reads only the first `limit` rows in the query's order. A caller that refuses
 * past a cap asks for one more than the cap and checks the length: an embedded list's or a query's
 * own `.limit()` can't do that, because PostgREST's `max-rows` cuts both at 1,000 without saying so.
 */
export async function fetchAllPages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<Row>>,
  failure: string,
  { pageSize = PAGE_SIZE, limit = Infinity }: { pageSize?: number; limit?: number } = {},
): Promise<Row[]> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    const rows = await readPages(fetchPage, failure, pageSize, limit);
    if (rows) return rows;
  }
  throw new Error(failure);
}

/** One pass over the pages; null when the rows changed under it. */
async function readPages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<Page<Row>>,
  failure: string,
  pageSize: number,
  limit: number,
): Promise<Row[] | null> {
  const rows: Row[] = [];
  let wanted = limit;
  let total: number | null = null;
  while (total === null || rows.length < wanted) {
    const { data, error, count } = await fetchPage(rows.length, Math.min(rows.length + pageSize, limit) - 1);
    if (error?.code === RANGE_NOT_SATISFIABLE) return null;
    if (error) throw translateDatabaseError(error, failure);
    // Without the total there is no telling a last page from a capped one.
    if (count === null) throw new Error(failure);
    if (total !== null && count !== total) return null;
    total = count;
    wanted = Math.min(total, limit);

    const page = data ?? [];
    // The total says there are more rows, but none came: they went between the count and the read.
    if (page.length === 0 && rows.length < wanted) return null;
    rows.push(...page);
  }
  return rows.length === wanted ? rows : null;
}
