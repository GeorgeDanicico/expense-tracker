/**
 * A small in-memory stand-in for the Supabase query builder, covering only what the data layer uses.
 * Every finished query is recorded in `queries` with its filters, so tests can assert owner scoping.
 */
type Row = Record<string, unknown>;
type Filter = [operator: "eq" | "is" | "gte" | "lt" | "or", column: string, value: unknown];
type Result = { data: Row[] | null; error: unknown; count: number | null };

export type RecordedQuery = {
  table: string;
  operation: "select" | "insert" | "upsert" | "update" | "delete";
  filters: Filter[];
  orders: string[];
  values?: Row;
  /** The column an `upsert` matches existing rows on. */
  onConflict?: string;
  range?: [number, number];
};

export type FakeSupabaseOptions = {
  /** The most rows a single `range` page returns, like PostgREST's `max-rows`. */
  pageCap?: number;
  /** Rewrites a written row, like a database trigger. */
  trigger?: (row: Row) => Row;
  /** Returns true for a query (by its position in `queries`) that should fail with a database error. */
  fail?: (query: RecordedQuery, index: number) => boolean;
};

const DATABASE_ERROR = { message: "private database failure" };

function matches(row: Row, [operator, column, value]: Filter) {
  if (operator === "eq" || operator === "is") return row[column] === value;
  if (operator === "gte") return String(row[column]) >= String(value);
  if (operator === "lt") return String(row[column]) < String(value);
  // `or` holds PostgREST `column.in.(a,b)` predicates; a row matches any of them.
  return [...String(value).matchAll(/(\w+)\.in\.\(([^)]*)\)/g)]
    .some(([, key, list]) => list.split(",").includes(String(row[key])));
}

export function fakeSupabase(tables: Record<string, Row[]> = {}, options: FakeSupabaseOptions = {}) {
  const queries: RecordedQuery[] = [];
  let nextId = 1;

  class Query {
    private readonly query: RecordedQuery;
    private readonly descending: boolean[] = [];

    constructor(table: string) {
      this.query = { table, operation: "select", filters: [], orders: [] };
    }

    // Columns and count options are ignored: tests read whole rows.
    select(...columns: unknown[]) { void columns; return this; }
    insert(values: Row) { return this.write("insert", values); }
    upsert(values: Row, { onConflict = "id" } = {}) {
      this.query.onConflict = onConflict;
      return this.write("upsert", values);
    }
    update(values: Row) { return this.write("update", values); }
    delete() { return this.write("delete"); }
    eq(column: string, value: unknown) { return this.filter("eq", column, value); }
    is(column: string, value: null) { return this.filter("is", column, value); }
    gte(column: string, value: string) { return this.filter("gte", column, value); }
    lt(column: string, value: string) { return this.filter("lt", column, value); }
    or(predicate: string) { return this.filter("or", "", predicate); }

    order(column: string, { ascending = true } = {}) {
      this.query.orders.push(column);
      this.descending.push(!ascending);
      return this;
    }

    async range(start: number, end: number) {
      this.query.range = [start, end];
      return this.run();
    }

    async maybeSingle() {
      const { data, error } = this.run();
      return { data: data?.[0] ?? null, error };
    }

    async single() {
      const { data, error } = this.run();
      if (error || data?.length !== 1) return { data: null, error: error ?? DATABASE_ERROR };
      return { data: data[0], error: null };
    }

    then<T>(resolve: (result: Result) => T, reject?: (reason: unknown) => T) {
      return Promise.resolve().then(() => this.run()).then(resolve, reject);
    }

    private write(operation: RecordedQuery["operation"], values?: Row) {
      Object.assign(this.query, { operation, values });
      return this;
    }

    private filter(...filter: Filter) {
      this.query.filters.push(filter);
      return this;
    }

    private run(): Result {
      const { table, operation, filters, orders, values, onConflict, range } = this.query;
      queries.push(this.query);
      if (options.fail?.(this.query, queries.length - 1)) return { data: null, error: DATABASE_ERROR, count: null };

      const rows = (tables[table] ??= []);
      const stored = (row: Row) => options.trigger?.(row) ?? row;
      if (operation === "insert") {
        const inserted = stored({ id: `row-${nextId++}`, ...values });
        rows.push(inserted);
        return { data: [inserted], error: null, count: 1 };
      }
      if (operation === "upsert") {
        const key = onConflict ?? "id";
        const existing = rows.find((row) => row[key] === values?.[key]);
        const written = stored({ ...existing, ...values });
        tables[table] = existing ? rows.map((row) => (row === existing ? written : row)) : [...rows, written];
        return { data: [written], error: null, count: 1 };
      }

      const found = rows.filter((row) => filters.every((filter) => matches(row, filter))).sort((a, b) => {
        for (const [index, column] of orders.entries()) {
          const order = String(a[column]).localeCompare(String(b[column]));
          if (order) return this.descending[index] ? -order : order;
        }
        return 0;
      });
      if (operation === "update") {
        const updated = found.map((row) => stored({ ...row, ...values }));
        tables[table] = rows.map((row) => updated[found.indexOf(row)] ?? row);
        return { data: updated, error: null, count: updated.length };
      }
      if (operation === "delete") {
        tables[table] = rows.filter((row) => !found.includes(row));
        return { data: found, error: null, count: found.length };
      }
      if (!range) return { data: found, error: null, count: found.length };
      const end = Math.min(range[1] + 1, range[0] + (options.pageCap ?? Infinity));
      return { data: found.slice(range[0], end), error: null, count: found.length };
    }
  }

  return { client: { from: (table: string) => new Query(table) }, queries, tables };
}
