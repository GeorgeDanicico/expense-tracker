/**
 * A small in-memory stand-in for the Supabase query builder, covering only what the data layer uses.
 * Every finished query is recorded in `queries` with its filters, so tests can assert owner scoping.
 *
 * Embedded tables are seeded as row fields: one row (`{ id, investment_accounts: { user_id } }`) or a
 * list of rows (`{ id, investment_transactions: [...] }`). A filter on `table.column` reads that field.
 * On a list, the query's filters, orders and limits for that table apply to the list, and, like
 * `!inner`, a filter drops a row whose list no longer has any rows.
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
  /** The columns (comma-separated) an `upsert` matches existing rows on. */
  onConflict?: string;
  range?: [number, number];
  /** `limit` calls, as `"<count>"`, or `"<foreignTable>:<count>"` for an embedded table. */
  limits?: string[];
};

export type RecordedRpc = { fn: string; args: Row };

export type FakeSupabaseOptions = {
  /** The most rows a single `range` page returns, like PostgREST's `max-rows`. */
  pageCap?: number;
  /** Rewrites a written row, like a database trigger. */
  trigger?: (row: Row) => Row;
  /**
   * Returns true for a query (by its position in `queries`) that should fail with a generic database
   * error, or the error itself, such as `{ code: "23505", message: "..." }`.
   */
  fail?: (query: RecordedQuery, index: number) => boolean | { code?: string; message: string };
  /** Answers `rpc(fn, args)` calls; without it, every call returns `{ data: null, error: null }`. */
  rpc?: (fn: string, args: Row) => { data: unknown; error: unknown };
};

const DATABASE_ERROR = { message: "private database failure" };

/** A column's value; a dotted `table.column` reads an embedded row seeded on `row[table]`. */
function read(row: Row, column: string): unknown {
  return column.split(".").reduce<unknown>((value, key) => (value as Row | undefined)?.[key], row);
}

/** Splits `table.column`, a column of an embedded table, into its parts. */
function embeddedColumn(column: string): [table: string, column: string] | null {
  const dot = column.indexOf(".");
  return dot < 0 ? null : [column.slice(0, dot), column.slice(dot + 1)];
}

function compareBy(orders: { column: string; descending: boolean }[]) {
  return (a: Row, b: Row) => {
    for (const { column, descending } of orders) {
      const order = String(a[column]).localeCompare(String(b[column]));
      if (order) return descending ? -order : order;
    }
    return 0;
  };
}

function matches(row: Row, [operator, column, value]: Filter) {
  const embeddedList = row[embeddedColumn(column)?.[0] ?? ""];
  // An embedded list was already narrowed to the matching rows (see `embed`).
  if (Array.isArray(embeddedList)) return embeddedList.length > 0;
  if (operator === "eq" || operator === "is") return read(row, column) === value;
  if (operator === "gte") return String(read(row, column)) >= String(value);
  if (operator === "lt") return String(read(row, column)) < String(value);
  // `or` holds PostgREST `column.in.(a,b)` predicates; a row matches any of them.
  return [...String(value).matchAll(/(\w+)\.in\.\(([^)]*)\)/g)]
    .some(([, key, list]) => list.split(",").includes(String(row[key])));
}

export function fakeSupabase(tables: Record<string, Row[]> = {}, options: FakeSupabaseOptions = {}) {
  const queries: RecordedQuery[] = [];
  const rpcs: RecordedRpc[] = [];
  let nextId = 1;

  class Query {
    private readonly query: RecordedQuery;
    private readonly orderBy: { column: string; descending: boolean }[] = [];
    /** Limits by table: `""` for this query's table, otherwise an embedded table. */
    private readonly limitBy = new Map<string, number>();

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

    /** An order on an embedded `foreignTable` is recorded as `table.column`. */
    order(column: string, { ascending = true, foreignTable }: { ascending?: boolean; foreignTable?: string } = {}) {
      const ordered = foreignTable ? `${foreignTable}.${column}` : column;
      this.query.orders.push(ordered);
      this.orderBy.push({ column: ordered, descending: !ascending });
      return this;
    }

    limit(count: number, { foreignTable }: { foreignTable?: string } = {}) {
      (this.query.limits ??= []).push(foreignTable ? `${foreignTable}:${count}` : String(count));
      this.limitBy.set(foreignTable ?? "", count);
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

    /**
     * Applies this query's filters, orders and limits on an embedded list to a copy of `row`.
     * Returns `row` itself when the query touches no embedded list, so writes still find the stored row.
     */
    private embed(row: Row): Row {
      const referenced = new Set([
        ...[...this.query.filters.map(([, column]) => column), ...this.query.orders]
          .map((column) => embeddedColumn(column)?.[0]),
        ...this.limitBy.keys(),
      ]);
      const lists = Object.keys(row).filter((key) => referenced.has(key) && Array.isArray(row[key]));
      if (!lists.length) return row;

      const copy = { ...row };
      for (const table of lists) {
        const onTable = (column: string) => embeddedColumn(column)?.[0] === table;
        const filters = this.query.filters
          .filter(([, column]) => onTable(column))
          .map(([operator, column, value]): Filter => [operator, embeddedColumn(column)![1], value]);
        const orders = this.orderBy
          .filter(({ column }) => onTable(column))
          .map(({ column, descending }) => ({ column: embeddedColumn(column)![1], descending }));
        copy[table] = (row[table] as Row[])
          .filter((embedded) => filters.every((filter) => matches(embedded, filter)))
          .sort(compareBy(orders))
          .slice(0, this.limitBy.get(table));
      }
      return copy;
    }

    private filter(...filter: Filter) {
      this.query.filters.push(filter);
      return this;
    }

    private run(): Result {
      const { table, operation, filters, values, onConflict, range } = this.query;
      queries.push(this.query);
      const failure = options.fail?.(this.query, queries.length - 1);
      if (failure) return { data: null, error: failure === true ? DATABASE_ERROR : failure, count: null };

      const rows = (tables[table] ??= []);
      const stored = (row: Row) => options.trigger?.(row) ?? row;
      if (operation === "insert") {
        const inserted = stored({ id: `row-${nextId++}`, ...values });
        rows.push(inserted);
        return { data: [inserted], error: null, count: 1 };
      }
      if (operation === "upsert") {
        const keys = (onConflict ?? "id").split(",");
        const existing = rows.find((row) => keys.every((key) => row[key] === values?.[key]));
        const written = stored({ ...existing, ...values });
        tables[table] = existing ? rows.map((row) => (row === existing ? written : row)) : [...rows, written];
        return { data: [written], error: null, count: 1 };
      }

      const found = rows
        .map((row) => this.embed(row))
        .filter((row) => filters.every((filter) => matches(row, filter)))
        .sort(compareBy(this.orderBy.filter(({ column }) => !embeddedColumn(column))))
        .slice(0, this.limitBy.get(""));
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

  async function rpc(fn: string, args: Row = {}) {
    rpcs.push({ fn, args });
    return options.rpc?.(fn, args) ?? { data: null, error: null };
  }

  return { client: { from: (table: string) => new Query(table), rpc }, queries, rpcs, tables };
}
