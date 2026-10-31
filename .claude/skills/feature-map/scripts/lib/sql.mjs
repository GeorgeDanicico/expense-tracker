// A small SQL reader for supabase/migrations and supabase/tests: splits a file into statements
// (respecting quotes, comments and $tag$ bodies) and recognises the DDL the feature map needs.
// It is not a SQL parser: statements it doesn't recognise are ignored.

/** Splits SQL into statements. Each has `raw` (as written), `clean` (comments removed) and `line`. */
export function splitStatements(sql) {
  const statements = [];
  let raw = "";
  let clean = "";
  let line = 1;
  let startLine = 1;
  let i = 0;
  const push = () => {
    if (clean.trim()) statements.push({ raw: raw.trim(), clean: clean.trim(), line: startLine });
    raw = "";
    clean = "";
  };
  while (i < sql.length) {
    const char = sql[i];
    const next = sql[i + 1];
    if (!clean.trim() && !/\s/.test(char)) startLine = line;
    if (char === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      raw += sql.slice(i, stop);
      i = stop;
      continue;
    }
    if (char === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      const stop = end === -1 ? sql.length : end + 2;
      const text = sql.slice(i, stop);
      line += (text.match(/\n/g) ?? []).length;
      raw += text;
      clean += " ";
      i = stop;
      continue;
    }
    if (char === "'" || char === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === char && sql[j + 1] === char) j += 2;
        else if (sql[j] === char) break;
        else j++;
      }
      const text = sql.slice(i, j + 1);
      line += (text.match(/\n/g) ?? []).length;
      raw += text;
      clean += text;
      i = j + 1;
      continue;
    }
    if (char === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const stop = end === -1 ? sql.length : end + tag[0].length;
        const text = sql.slice(i, stop);
        line += (text.match(/\n/g) ?? []).length;
        raw += text;
        clean += text;
        i = stop;
        continue;
      }
    }
    if (char === ";") {
      raw += char;
      push();
      i++;
      continue;
    }
    if (char === "\n") line++;
    raw += char;
    clean += char;
    i++;
  }
  push();
  return statements;
}

const unquote = (name) => name.replace(/"/g, "");

/** `public.x` → `x`; other schemas stay qualified. Lower-cased, unquoted. */
export function tableId(name) {
  const plain = unquote(name).toLowerCase();
  return plain.startsWith("public.") ? plain.slice(7) : plain;
}

/** Functions are always `schema.name`; an unqualified name is in `public`. */
export function functionId(name) {
  const plain = unquote(name).toLowerCase();
  return plain.includes(".") ? plain : `public.${plain}`;
}

/** Reads the string literal starting at `text` (`'...'` with `''` escapes, or `$tag$...$tag$`). */
function readLiteral(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("'")) {
    let out = "";
    for (let i = 1; i < trimmed.length; i++) {
      if (trimmed[i] === "'" && trimmed[i + 1] === "'") {
        out += "'";
        i++;
      } else if (trimmed[i] === "'") return out;
      else out += trimmed[i];
    }
    return out;
  }
  const tag = /^\$[A-Za-z_]*\$/.exec(trimmed);
  if (tag) {
    const end = trimmed.indexOf(tag[0], tag[0].length);
    return trimmed.slice(tag[0].length, end === -1 ? undefined : end);
  }
  return null;
}

const NAME = String.raw`(?:"[^"]+"|[\w$]+)(?:\.(?:"[^"]+"|[\w$]+))?`;

/** Recognises one statement. Returns `{ type, ... }` or null. */
export function classify(statement) {
  const text = statement.clean.replace(/\s+/g, " ");
  const lower = text.toLowerCase();
  let m;

  if ((m = new RegExp(String.raw`^create (?:unlogged )?table (?:if not exists )?(${NAME})`, "i").exec(text))) {
    return { type: "create_table", table: tableId(m[1]) };
  }
  if ((m = new RegExp(String.raw`^drop table (?:if exists )?(${NAME}(?:\s*,\s*${NAME})*)`, "i").exec(text))) {
    return { type: "drop_table", tables: m[1].split(",").map((name) => tableId(name.trim())) };
  }
  if ((m = new RegExp(String.raw`^alter table (?:if exists )?(?:only )?(${NAME}) rename to (${NAME})`, "i").exec(text))) {
    const from = tableId(m[1]);
    const schema = from.includes(".") ? `${from.split(".")[0]}.` : "";
    return { type: "rename_table", from, to: tableId(`${schema}${unquote(m[2])}`) };
  }
  if ((m = new RegExp(String.raw`^alter table (?:if exists )?(?:only )?(${NAME})`, "i").exec(text))) {
    return {
      type: "alter_table",
      table: tableId(m[1]),
      enablesRls: /enable row level security/i.test(text),
      forcesRls: /force row level security/i.test(text),
    };
  }
  if ((m = new RegExp(String.raw`^create (?:or replace )?function (${NAME})\s*\(`, "i").exec(text))) {
    const header = text.split(/\bas \$|\bas '/i)[0];
    return {
      type: "create_function",
      fn: functionId(m[1]),
      returnsTrigger: /\breturns trigger\b/i.test(header),
      securityDefiner: /\bsecurity definer\b/i.test(text),
      language: (/\blanguage (\w+)/i.exec(text)?.[1] ?? "").toLowerCase(),
      body: statement.clean,
    };
  }
  if ((m = new RegExp(String.raw`^drop function (?:if exists )?(${NAME})`, "i").exec(text))) {
    return { type: "drop_function", fn: functionId(m[1]) };
  }
  if ((m = new RegExp(String.raw`^create policy ("[^"]+"|[\w$]+) on (${NAME})(.*)$`, "i").exec(text))) {
    const rest = m[3];
    const command = (/^\s*(?:as \w+ )?for (all|select|insert|update|delete)\b/i.exec(rest)?.[1] ?? "all").toLowerCase();
    const roles = /\bto ([\w, ]+?)(?: using| with check|$)/i.exec(rest)?.[1]?.split(",").map((role) => role.trim().toLowerCase()) ?? ["public"];
    return { type: "create_policy", policy: unquote(m[1]), table: tableId(m[2]), command, roles, body: statement.clean };
  }
  if ((m = new RegExp(String.raw`^drop policy (?:if exists )?("[^"]+"|[\w$]+) on (${NAME})`, "i").exec(text))) {
    return { type: "drop_policy", policy: unquote(m[1]), table: tableId(m[2]) };
  }
  if ((m = new RegExp(String.raw`^alter policy ("[^"]+"|[\w$]+) on (${NAME}) rename to ("[^"]+"|[\w$]+)`, "i").exec(text))) {
    return { type: "rename_policy", policy: unquote(m[1]), table: tableId(m[2]), to: unquote(m[3]) };
  }
  if ((m = new RegExp(String.raw`^create (?:or replace )?(?:constraint )?trigger ([\w$]+) (before|after|instead of) (.+?) on (${NAME}).*?execute (?:function|procedure) (${NAME})`, "i").exec(text))) {
    return { type: "create_trigger", trigger: m[1].toLowerCase(), timing: m[2].toLowerCase(), events: m[3].toLowerCase(), table: tableId(m[4]), fn: functionId(m[5]) };
  }
  if ((m = new RegExp(String.raw`^drop trigger (?:if exists )?([\w$]+) on (${NAME})`, "i").exec(text))) {
    return { type: "drop_trigger", trigger: m[1].toLowerCase(), table: tableId(m[2]) };
  }
  if ((m = new RegExp(String.raw`^create (?:unique )?index (?:concurrently )?(?:if not exists )?([\w$]+ )?on (?:only )?(${NAME})`, "i").exec(text))) {
    return { type: "create_index", index: (m[1] ?? "").trim().toLowerCase(), table: tableId(m[2]) };
  }
  if ((m = new RegExp(String.raw`^drop index (?:concurrently )?(?:if exists )?(${NAME})`, "i").exec(text))) {
    return { type: "drop_index", index: unquote(m[1]).toLowerCase().replace(/^public\./, "") };
  }
  if ((m = new RegExp(String.raw`^create (?:or replace )?(?:materialized )?view (?:if not exists )?(${NAME})`, "i").exec(text))) {
    return { type: "create_view", table: tableId(m[1]), body: statement.clean };
  }
  if ((m = /^create schema (?:if not exists )?([\w$]+)/i.exec(text))) {
    return { type: "create_schema", schema: m[1].toLowerCase() };
  }
  if ((m = new RegExp(String.raw`^create type (${NAME})`, "i").exec(text))) {
    return { type: "create_type", name: tableId(m[1]) };
  }
  if (/^insert into storage\.buckets\b/i.test(text)) {
    const values = /\bvalues\s*\(\s*'([^']+)'/i.exec(text);
    return values ? { type: "create_bucket", bucket: values[1] } : null;
  }
  if ((m = new RegExp(String.raw`^comment on (table|view|function) (${NAME})(?:\s*\([^)]*\))? is (.*)$`, "is").exec(statement.clean.trim()))) {
    const kind = m[1].toLowerCase();
    const id = kind === "function" ? functionId(m[2]) : tableId(m[2]);
    return { type: "comment", kind, id, text: readLiteral(m[3]) ?? "" };
  }
  if (lower.startsWith("select plan(") || /^select \* from plan\(/.test(lower)) {
    return { type: "plan", count: Number(/plan\((\d+)\)/i.exec(text)?.[1] ?? 0) };
  }
  return null;
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Which of `tables` and `functions` (ids as returned by tableId/functionId) `text` mentions.
 * Public objects may appear unqualified; a table counts only after a keyword that names a relation
 * (from, join, into, update, on, table, references…) or when schema-qualified, so a column
 * that shares a table's name isn't taken for it.
 */
export function findReferences(text, tables, functions) {
  const lower = text.toLowerCase();
  const found = { tables: new Set(), functions: new Set() };
  for (const table of tables) {
    const [schema, name] = table.includes(".") ? table.split(".") : ["public", table];
    const qualified = new RegExp(String.raw`\b${escapeRegExp(schema)}\.${escapeRegExp(name)}\b`);
    const bare = schema === "public"
      ? new RegExp(String.raw`\b(?:from|join|into|update|on|table|references|exists|truncate|only)\s+${escapeRegExp(name)}\b`)
      : null;
    if (qualified.test(lower) || (bare && bare.test(lower))) found.tables.add(table);
  }
  for (const fn of functions) {
    const [schema, name] = fn.split(".");
    const qualified = new RegExp(String.raw`\b${escapeRegExp(schema)}\.${escapeRegExp(name)}\s*\(`);
    const bare = schema === "public" ? new RegExp(String.raw`(?<![\w.])${escapeRegExp(name)}\s*\(`) : null;
    const trigger = new RegExp(String.raw`execute (?:function|procedure) (?:${escapeRegExp(schema)}\.)?${escapeRegExp(name)}\b`);
    if (qualified.test(lower) || (bare && bare.test(lower)) || trigger.test(lower)) found.functions.add(fn);
  }
  return found;
}
