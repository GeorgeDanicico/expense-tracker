#!/usr/bin/env node
// Finds repeated code shapes in this repo, as input for the find-simpler-ways skill.
// Plain Node plus the repo's own `typescript` dev dependency (for parsing). Read-only: it never writes files.
//
//   node .claude/skills/find-simpler-ways/scripts/find-shapes.mjs [target ...] [options]
//
// Targets are files or folders relative to the repo root (default: src), or a bare module name such as
// `reminders` or `todos`, which means every corpus file with that name (or its singular) as a folder,
// a file name, or a file-name prefix (src/lib/todos/*, src/lib/mcp/tools/todos.ts, src/test/todo-board.ts…).
// Repeats are looked for across
// the whole corpus (default: src), and a finding is shown when at least one of its places is in a target,
// so a todos route that copies a reminders route still shows up when the target is src/app/api/todos.
//
// Options:
//   --sections=a,b    Only these sections: map, clones, files, routes, hooks, schemas, wrappers, tests (default: all)
//   --corpus=dir      Where to look for repeats and importers (default: src)
//   --min-nodes=N     Smallest function, in AST nodes, that counts as a clone (default: 40)
//   --threshold=X     Similarity (0..1) for near-duplicate files (default: 0.6)
//   --top=N           Rows per section (default: 15)
//   --json            Print raw JSON instead of Markdown
//   --help

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// ---------------------------------------------------------------- setup

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  const header = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 22);
  console.log(header.map((line) => line.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(0);
}
const option = (name, fallback) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const flag = (name) => args.includes(`--${name}`);

function findRoot(start) {
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "node_modules", "typescript"))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}
const ROOT = findRoot(process.cwd()) ?? findRoot(path.dirname(new URL(import.meta.url).pathname));
if (!ROOT) {
  console.error("Run this inside the repo after `npm install`: it needs node_modules/typescript.");
  process.exit(1);
}
const ts = createRequire(path.join(ROOT, "package.json"))("typescript");

const ALL_SECTIONS = ["map", "clones", "files", "routes", "hooks", "schemas", "wrappers", "tests"];
const SECTIONS = new Set(option("sections", ALL_SECTIONS.join(",")).split(",").map((s) => s.trim()).filter(Boolean));
for (const section of SECTIONS) {
  if (!ALL_SECTIONS.includes(section)) {
    console.error(`Unknown section "${section}". Use: ${ALL_SECTIONS.join(", ")}`);
    process.exit(1);
  }
}
const CORPUS_DIR = option("corpus", "src");
const MIN_NODES = Number(option("min-nodes", "40"));
const THRESHOLD = Number(option("threshold", "0.6"));
const TOP = Number(option("top", "15"));
const AS_JSON = flag("json");
const targets = args.filter((arg) => !arg.startsWith("--"));
if (targets.length === 0) targets.push(CORPUS_DIR);

const IGNORED_DIRS = new Set(["node_modules", ".next", ".git", ".claude", "tmp", "dist", "coverage", "__snapshots__"]);
const IGNORED_FILES = [/\.d\.ts$/, /database\.types\.ts$/];
const SOURCE = /\.(ts|tsx|mts|js|mjs|jsx)$/;

function walk(entry, out = []) {
  const full = path.resolve(ROOT, entry);
  if (!fs.existsSync(full)) {
    console.error(`No such file or folder: ${entry}`);
    process.exit(1);
  }
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    if (SOURCE.test(full) && !IGNORED_FILES.some((re) => re.test(full))) out.push(full);
    return out;
  }
  for (const name of fs.readdirSync(full).sort()) {
    if (IGNORED_DIRS.has(name)) continue;
    walk(path.join(full, name), out);
  }
  return out;
}

const rel = (file) => path.relative(ROOT, file);
const corpusList = walk(CORPUS_DIR);

/** A path, or a bare module name expanded to the corpus files named after it. */
function expandTarget(target) {
  if (fs.existsSync(path.resolve(ROOT, target)) || /[\\/.]/.test(target)) return walk(target);
  const names = new Set([target.toLowerCase(), target.toLowerCase().replace(/s$/, "")]);
  const matches = corpusList.filter((file) => rel(file).split(/[\\/]/).some((segment) => {
    const base = segment.replace(/\.(test\.)?(ts|tsx|mts|js|mjs|jsx)$/, "").toLowerCase();
    return [...names].some((n) => base === n || base.startsWith(`${n}-`));
  }));
  if (matches.length === 0) {
    console.error(`No such file or folder, and no files named after a module "${target}".`);
    process.exit(1);
  }
  return matches;
}
const targetList = targets.flatMap(expandTarget);
const corpusFiles = [...new Set([...corpusList, ...targetList])];
const targetFiles = new Set(targetList);
const isTest = (file) => /\.test\.(ts|tsx|mts|js|mjs)$/.test(file) || /(^|[\\/])src[\\/]test[\\/]/.test(rel(file));

const sources = new Map();
for (const file of corpusFiles) {
  const text = fs.readFileSync(file, "utf8");
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : file.endsWith(".js") || file.endsWith(".mjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  sources.set(file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind));
}

const lineOf = (node) => node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
const where = (node) => `${rel(node.getSourceFile().fileName)}:${lineOf(node)}`;
const squash = (text, max = 90) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const report = {};

function visit(node, fn) {
  fn(node);
  ts.forEachChild(node, (child) => visit(child, fn));
}

// ---------------------------------------------------------------- import graph (map, wrappers)

function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(ROOT, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  const candidates = [base, ...[".ts", ".tsx", ".mts", ".js", ".mjs"].map((ext) => base + ext), ...["index.ts", "index.tsx"].map((i) => path.join(base, i))];
  return candidates.find((c) => sources.has(c) && fs.statSync(c).isFile()) ?? null;
}

/** file -> Map<importerFile, Set<name>>  ("*" means the whole module, e.g. `import * as`, vi.mock, import()). */
const importers = new Map();
function addUse(target, from, name) {
  if (!target) return;
  if (!importers.has(target)) importers.set(target, new Map());
  const byFile = importers.get(target);
  if (!byFile.has(from)) byFile.set(from, new Set());
  byFile.get(from).add(name);
}
for (const [file, sf] of sources) {
  visit(sf, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const target = resolveImport(file, node.moduleSpecifier.text);
      if (ts.isImportDeclaration(node)) {
        const clause = node.importClause;
        if (!clause) return addUse(target, file, "*");
        if (clause.name) addUse(target, file, "default");
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) addUse(target, file, "*");
        if (bindings && ts.isNamedImports(bindings)) for (const el of bindings.elements) addUse(target, file, (el.propertyName ?? el.name).text);
      } else {
        const clause = node.exportClause;
        if (!clause || !ts.isNamedExports(clause)) addUse(target, file, "*");
        else for (const el of clause.elements) addUse(target, file, (el.propertyName ?? el.name).text);
      }
    }
    // import("x"), vi.mock("x"), vi.importActual("x"), require("x")
    if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) {
      const callee = node.expression.getText(sf);
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || /^(vi\.(mock|doMock|importActual|importMock)|require)$/.test(callee)) {
        addUse(resolveImport(file, node.arguments[0].text), file, "*");
      }
    }
  });
}

function exportsOf(sf) {
  const names = [];
  for (const stmt of sf.statements) {
    const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) ?? [] : [];
    const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const isDefault = mods.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
    if (ts.isExportAssignment(stmt)) names.push("default");
    if (!exported) continue;
    if (isDefault) names.push("default");
    else if (ts.isVariableStatement(stmt)) for (const d of stmt.declarationList.declarations) names.push(d.name.getText(sf));
    else if (stmt.name) names.push(stmt.name.getText(sf));
  }
  return names;
}

// Names Next.js (or the test runner) reads from convention files, so "no importers" is expected for them.
const NEXT_FILE = /(^|[\\/])(page|layout|route|loading|error|not-found|template|default|global-error|manifest|proxy|middleware|instrumentation|sitemap|robots|opengraph-image|icon|apple-icon)\.(tsx?|mts|js)$/;
const NEXT_NAMES = new Set(["default", "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "metadata", "generateMetadata", "viewport", "generateViewport", "generateStaticParams", "dynamic", "runtime", "revalidate", "maxDuration", "config", "preferredRegion", "fetchCache", "dynamicParams"]);

if (SECTIONS.has("map")) {
  const rows = [];
  for (const file of [...targetFiles].sort()) {
    const sf = sources.get(file);
    const exports = exportsOf(sf);
    const users = importers.get(file) ?? new Map();
    const used = new Set([...users.values()].flatMap((set) => [...set]));
    const unused = used.has("*") || isTest(file) ? [] : exports.filter((n) => !used.has(n) && !(NEXT_FILE.test(file) && NEXT_NAMES.has(n)));
    const userFiles = [...users.keys()];
    rows.push({
      file: rel(file),
      lines: sf.getLineStarts().length,
      exports,
      importers: userFiles.length,
      importedBy: userFiles.filter((f) => !isTest(f)).map(rel).slice(0, 6),
      testImporters: userFiles.filter(isTest).length,
      unusedExports: unused,
    });
  }
  report.map = rows;
}

// ---------------------------------------------------------------- structural fingerprints

/** Node kinds, with every identifier and literal made anonymous, so renamed copies match. */
function fingerprint(node) {
  const parts = [];
  let count = 0;
  const walkNode = (n) => {
    count += 1;
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) parts.push("I");
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isNumericLiteral(n) || n.kind === ts.SyntaxKind.BigIntLiteral) parts.push("L");
    else if (n.kind >= ts.SyntaxKind.FirstTemplateToken && n.kind <= ts.SyntaxKind.LastTemplateToken) parts.push("T");
    else {
      parts.push(String(n.kind), "(");
      ts.forEachChild(n, walkNode);
      parts.push(")");
    }
  };
  walkNode(node);
  return { key: parts.join(" "), size: count };
}

const functionName = (fn) => {
  if (fn.name) return fn.name.getText();
  const parent = fn.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) return parent.name.getText();
  if (ts.isCallExpression(parent)) {
    const callee = parent.expression.getText();
    if (ts.isVariableDeclaration(parent.parent)) return `${parent.parent.name.getText()} = ${callee}(…)`;
    if (/^(it|test)(\.\w+)?$/.test(callee) && parent.arguments[0] && ts.isStringLiteralLike(parent.arguments[0])) return `${callee}("${squash(parent.arguments[0].text, 50)}")`;
    return `${callee}(…) callback`;
  }
  return "(anonymous)";
};
const isFunctionLike = (n) => ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isMethodDeclaration(n);
const isTestCallback = (fn) => ts.isCallExpression(fn.parent) && /^(it|test)(\.(only|skip|concurrent|fails))?$/.test(fn.parent.expression.getText());

/** Keeps only groups that touch a target, biggest first, dropping groups nested inside a bigger reported one. */
function pickGroups(groups, limit) {
  const chosen = [];
  const covered = [];
  const inside = (m) => covered.some((c) => c.file === m.file && c.start <= m.start && m.end <= c.end);
  for (const group of groups.sort((a, b) => b.size * b.members.length - a.size * a.members.length)) {
    if (!group.members.some((m) => targetFiles.has(m.file))) continue;
    if (group.members.every(inside)) continue;
    chosen.push(group);
    covered.push(...group.members);
    if (chosen.length >= limit) break;
  }
  return chosen;
}

if (SECTIONS.has("clones") || SECTIONS.has("tests")) {
  const byKey = new Map();
  const testsByKey = new Map();
  for (const [file, sf] of sources) {
    visit(sf, (node) => {
      if (!isFunctionLike(node) || !node.body) return;
      const fp = fingerprint(node.body);
      const member = { file, start: node.getStart(), end: node.getEnd(), at: where(node), name: functionName(node), text: node.body.getText().replace(/\s+/g, " ") };
      if (isTestCallback(node)) {
        if (fp.size < 20) return;
        const key = `${file}|${fp.key}`; // it.each candidates live in one file
        if (!testsByKey.has(key)) testsByKey.set(key, { size: fp.size, members: [] });
        testsByKey.get(key).members.push(member);
      } else {
        if (fp.size < MIN_NODES) return;
        if (!byKey.has(fp.key)) byKey.set(fp.key, { size: fp.size, members: [] });
        byKey.get(fp.key).members.push(member);
      }
    });
  }
  const shape = (group) => ({
    nodes: group.size,
    count: group.members.length,
    identicalText: new Set(group.members.map((m) => m.text)).size === 1,
    places: group.members.map((m) => `${m.at} ${m.name}`),
  });
  if (SECTIONS.has("clones")) {
    report.clones = pickGroups([...byKey.values()].filter((g) => g.members.length > 1), TOP).map(shape);
    // Top-level functions with the same name in several non-test files: often one helper written twice.
    const byName = new Map();
    for (const [file, sf] of sources) {
      if (isTest(file)) continue;
      for (const stmt of sf.statements) {
        let name = null;
        if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) name = stmt.name.text; // skip overload signatures
        if (ts.isVariableStatement(stmt)) {
          const d = stmt.declarationList.declarations[0];
          if (d && ts.isIdentifier(d.name) && d.initializer && isFunctionLike(d.initializer)) name = d.name.text;
        }
        if (!name || NEXT_NAMES.has(name)) continue;
        if (!byName.has(name)) byName.set(name, []);
        byName.get(name).push({ file, at: `${rel(file)}:${lineOf(stmt)}` });
      }
    }
    report.sameName = [...byName].filter(([, l]) => new Set(l.map((x) => x.file)).size > 1 && l.some((x) => targetFiles.has(x.file)))
      .sort((a, b) => b[1].length - a[1].length).map(([name, l]) => `${name} ×${l.length}: ${l.slice(0, 5).map((x) => x.at).join("; ")}`);
  }
  if (SECTIONS.has("tests")) {
    const testGroups = [...testsByKey.values()].filter((g) => g.members.length > 1);
    report.testShapes = pickGroups(testGroups, TOP).map(shape);
  }
}

// ---------------------------------------------------------------- near-duplicate files

if (SECTIONS.has("files")) {
  const K = 10;
  const HASHES = 96;
  const PRIME = 4294967311;
  const seeds = Array.from({ length: HASHES }, (_, i) => [((i + 1) * 2654435761) % PRIME, ((i + 7) * 40503) % PRIME]);
  const fnv = (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  const tokensOf = (sf) => {
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, sf.languageVariant, sf.text);
    const out = [];
    for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
      if (kind === ts.SyntaxKind.Identifier) out.push("I");
      else if (kind === ts.SyntaxKind.StringLiteral || kind === ts.SyntaxKind.NumericLiteral || kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral) out.push("L");
      else out.push(String(kind));
    }
    return out;
  };
  const entries = [];
  for (const [file, sf] of sources) {
    // Skip imports: every file starts with them and they say little about the shape.
    const body = sf.statements.filter((s) => !ts.isImportDeclaration(s));
    if (body.length === 0) continue;
    const tokens = tokensOf(ts.createSourceFile(file, body.map((s) => s.getText(sf)).join("\n"), ts.ScriptTarget.Latest, false, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
    if (tokens.length < 60) continue;
    const shingles = new Set();
    for (let i = 0; i + K <= tokens.length; i += 1) shingles.add(fnv(tokens.slice(i, i + K).join(",")));
    const signature = seeds.map(([a, b]) => {
      let min = Infinity;
      for (const h of shingles) {
        const v = (a * h + b) % PRIME;
        if (v < min) min = v;
      }
      return min;
    });
    entries.push({ file, shingles, signature, lines: sf.getLineStarts().length });
  }
  const pairs = [];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i];
      const b = entries[j];
      if (!targetFiles.has(a.file) && !targetFiles.has(b.file)) continue;
      let same = 0;
      for (let h = 0; h < HASHES; h += 1) if (a.signature[h] === b.signature[h]) same += 1;
      if (same / HASHES < THRESHOLD - 0.1) continue;
      let shared = 0;
      for (const h of a.shingles) if (b.shingles.has(h)) shared += 1;
      const similarity = shared / (a.shingles.size + b.shingles.size - shared);
      if (similarity >= THRESHOLD) pairs.push({ similarity: Number(similarity.toFixed(2)), a: `${rel(a.file)} (${a.lines})`, b: `${rel(b.file)} (${b.lines})` });
    }
  }
  report.similarFiles = pairs.sort((x, y) => y.similarity - x.similarity).slice(0, TOP * 2);
}

// ---------------------------------------------------------------- route handlers

/** The module each imported name comes from, for one file. */
function importSources(sf) {
  const map = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const spec = stmt.moduleSpecifier.text;
    if (stmt.importClause.name) map.set(stmt.importClause.name.text, spec);
    const b = stmt.importClause.namedBindings;
    if (b && ts.isNamedImports(b)) for (const el of b.elements) map.set(el.name.text, spec);
    if (b && ts.isNamespaceImport(b)) map.set(b.name.text, spec);
  }
  return map;
}
const rootIdentifier = (expr) => {
  while (ts.isPropertyAccessExpression(expr) || ts.isCallExpression(expr) || ts.isElementAccessExpression(expr) || ts.isNonNullExpression(expr)) expr = expr.expression;
  return ts.isIdentifier(expr) ? expr.text : null;
};

if (SECTIONS.has("routes")) {
  const HTTP = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
  const routeFiles = [...sources.keys()].filter((f) => /[\\/]app[\\/].*[\\/]route\.(ts|js)$/.test(f));
  // A module counts as shared plumbing when at least a quarter of the route files import it.
  const moduleUse = new Map();
  for (const f of routeFiles) for (const spec of new Set(importSources(sources.get(f)).values())) moduleUse.set(spec, (moduleUse.get(spec) ?? 0) + 1);
  const shared = new Set([...moduleUse].filter(([, n]) => n >= Math.max(2, routeFiles.length / 4)).map(([spec]) => spec));

  const handlers = [];
  const contextTypes = [];
  for (const file of routeFiles) {
    const sf = sources.get(file);
    const from = importSources(sf);
    // Hand-written route context types, whether named (`type XRouteContext = …`) or inline on a parameter.
    visit(sf, (n) => {
      if (!ts.isTypeLiteralNode(n) || !/^\{\s*params\s*:\s*Promise</.test(n.getText(sf))) return;
      const label = ts.isTypeAliasDeclaration(n.parent) ? `type ${n.parent.name.text}` : "inline";
      contextTypes.push({ file, at: `${where(n)} ${label}` });
    });
    for (const stmt of sf.statements) {
      let name;
      let body;
      if (ts.isFunctionDeclaration(stmt) && stmt.name && HTTP.has(stmt.name.text)) [name, body] = [stmt.name.text, stmt];
      if (ts.isVariableStatement(stmt)) {
        const d = stmt.declarationList.declarations[0];
        if (d && HTTP.has(d.name.getText(sf))) [name, body] = [d.name.getText(sf), d.initializer];
      }
      if (!name || !body) continue;
      const wrapper = body && ts.isCallExpression(body) ? body.expression.getText(sf) : "none";
      // Calls in the order they run (arguments before the call that takes them), skipping the
      // receiver of a chain such as the `getRepositories()` in `getRepositories().todos.update(…)`.
      const steps = [];
      const walkCalls = (n) => {
        ts.forEachChild(n, walkCalls);
        if (!ts.isCallExpression(n) || n === body) return;
        if (ts.isPropertyAccessExpression(n.parent) || ts.isElementAccessExpression(n.parent)) return;
        const id = rootIdentifier(n.expression);
        if (!id) return;
        const spec = from.get(id);
        const step = spec && shared.has(spec) ? (ts.isIdentifier(n.expression) ? id : n.expression.getText(sf).replace(/\(.*?\)/g, "()")) : spec ? "<domain call>" : null;
        if (step && steps[steps.length - 1] !== step) steps.push(step);
      };
      walkCalls(body);
      const options = ts.isCallExpression(body) && body.arguments[1] ? squash(body.arguments[1].getText(sf), 60) : "";
      handlers.push({ file, at: `${rel(file)} ${name}`, wrapper, skeleton: steps.join(" → "), options, lines: body.getText(sf).split("\n").length });
    }
  }
  const touches = (list) => list.some((h) => targetFiles.has(h.file));
  const bySkeleton = new Map();
  for (const h of handlers) {
    const key = `${h.wrapper} | ${h.skeleton}`;
    if (!bySkeleton.has(key)) bySkeleton.set(key, []);
    bySkeleton.get(key).push(h);
  }
  const wrappers = {};
  for (const h of handlers) wrappers[h.wrapper] = (wrappers[h.wrapper] ?? 0) + 1;
  report.routes = {
    routeFiles: routeFiles.length,
    handlers: handlers.length,
    targetHandlers: handlers.filter((h) => targetFiles.has(h.file)).map((h) => `${h.at} (${h.lines} lines) ${h.wrapper} | ${h.skeleton}`),
    wrappers,
    sharedModules: [...shared],
    skeletons: [...bySkeleton].filter(([, list]) => list.length > 1 && touches(list)).sort((a, b) => b[1].length - a[1].length).slice(0, TOP)
      .map(([key, list]) => ({ skeleton: key, count: list.length, examples: list.slice(0, 5).map((h) => h.at) })),
    withoutWrapper: handlers.filter((h) => h.wrapper === "none").map((h) => h.at).slice(0, TOP),
    localContextTypes: contextTypes.map((c) => `${c.at}${targetFiles.has(c.file) ? "  (target)" : ""}`),
  };
}

// ---------------------------------------------------------------- SWR, fetch, form state

if (SECTIONS.has("hooks")) {
  const SWR = /^(useSWR|useSWRImmutable|useSWRInfinite|useSWRMutation|useSWRConfig|mutate|globalMutate|preload)$/;
  const swrCalls = [];
  const fetches = [];
  const formState = [];
  const customHooks = [];
  for (const [file, sf] of sources) {
    const stateNames = [];
    visit(sf, (node) => {
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(sf);
        if (SWR.test(callee) && node.arguments.length > 0) swrCalls.push({ file, at: where(node), call: callee, key: squash(node.arguments[0].getText(sf), 70) });
        if (callee === "fetch" || callee === "window.fetch") {
          const init = node.arguments[1] ? node.arguments[1].getText(sf) : "";
          const method = (/method:\s*["'`](\w+)/.exec(init) ?? [null, "GET"])[1];
          fetches.push({ file, at: where(node), method, url: squash(node.arguments[0]?.getText(sf) ?? "", 60) });
        }
        if (callee === "useState" && ts.isArrayBindingPattern(node.parent.name ?? {})) {
          const first = node.parent.name.elements[0];
          if (first && ts.isBindingElement(first)) stateNames.push(first.name.getText(sf));
        }
      }
      if ((ts.isFunctionDeclaration(node) && node.name && /^use[A-Z]/.test(node.name.text) && sf.statements.includes(node)) ||
        (ts.isVariableDeclaration(node) && /^use[A-Z]/.test(node.name.getText(sf)) && node.initializer && isFunctionLike(node.initializer))) {
        if (!isTest(file)) customHooks.push({ file, name: node.name.getText(sf) });
      }
    });
    const formish = stateNames.filter((n) => /^(pending|isPending|saving|isSaving|submitting|isSubmitting|loading|error|formError|fieldErrors|errors)$/.test(n));
    if (formish.length >= 2) formState.push({ file, at: rel(file), states: formish });
  }
  const group = (list, keyOf) => {
    const map = new Map();
    for (const item of list) {
      const key = keyOf(item);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return [...map].filter(([, items]) => items.length > 1 && items.some((i) => targetFiles.has(i.file))).sort((a, b) => b[1].length - a[1].length).slice(0, TOP)
      .map(([key, items]) => ({ key, count: items.length, places: items.slice(0, 6).map((i) => i.at) }));
  };
  report.hooks = {
    swrCallsInTarget: swrCalls.filter((c) => targetFiles.has(c.file)).map((c) => `${c.at} ${c.call}(${c.key})`),
    // Reads only: repeated `mutate(KEY)` calls are normal, but the same `useSWR(KEY)` in many components may want one named hook.
    swrKeysUsedMoreThanOnce: group(swrCalls.filter((c) => /^(useSWR|useSWRImmutable|useSWRInfinite|preload)$/.test(c.call)), (c) => `${c.call}(${c.key})`),
    hooksDefinedTwice: group(customHooks.map((h) => ({ ...h, at: rel(h.file) })), (h) => h.name),
    fetchCallsInTarget: fetches.filter((f) => targetFiles.has(f.file)).map((f) => `${f.at} ${f.method} ${f.url}`),
    fetchCallsTotal: fetches.length,
    manualFormState: formState.filter((f) => targetFiles.has(f.file)).map((f) => `${f.at}: ${f.states.join(", ")}`),
    manualFormStateTotal: formState.length,
    customHooksInTarget: customHooks.filter((h) => targetFiles.has(h.file)).map((h) => `${rel(h.file)} ${h.name}`),
  };
}

// ---------------------------------------------------------------- zod schemas

if (SECTIONS.has("schemas")) {
  const objects = [];
  const fields = [];
  for (const [file, sf] of sources) {
    visit(sf, (node) => {
      if (!ts.isCallExpression(node)) return;
      const callee = node.expression.getText(sf);
      if (!/^z\.(object|strictObject|looseObject)$/.test(callee)) return;
      const arg = node.arguments[0];
      if (!arg || !ts.isObjectLiteralExpression(arg)) return;
      const keys = [];
      for (const prop of arg.properties) {
        if (!prop.name) continue;
        keys.push(prop.name.getText(sf));
        if (ts.isPropertyAssignment(prop)) fields.push({ file, at: where(prop), def: squash(prop.initializer.getText(sf), 100) });
      }
      const owner = ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(sf) : ts.isPropertyAssignment(node.parent) ? node.parent.name.getText(sf) : "(inline)";
      objects.push({ file, at: `${where(node)} ${owner}`, keys: keys.sort() });
    });
  }
  const inTarget = (list) => list.some((o) => targetFiles.has(o.file));
  const sameKeys = new Map();
  for (const o of objects) if (o.keys.length >= 2) {
    const key = o.keys.join(",");
    if (!sameKeys.has(key)) sameKeys.set(key, []);
    sameKeys.get(key).push(o);
  }
  const overlaps = [];
  for (let i = 0; i < objects.length; i += 1) {
    for (let j = i + 1; j < objects.length; j += 1) {
      const [a, b] = [objects[i], objects[j]];
      if (!inTarget([a, b]) || a.keys.join() === b.keys.join()) continue;
      const shared = a.keys.filter((k) => b.keys.includes(k));
      if (shared.length < 3) continue;
      const jaccard = shared.length / new Set([...a.keys, ...b.keys]).size;
      if (jaccard >= 0.6) overlaps.push({ overlap: Number(jaccard.toFixed(2)), a: a.at, b: b.at, onlyA: a.keys.filter((k) => !shared.includes(k)), onlyB: b.keys.filter((k) => !shared.includes(k)) });
    }
  }
  const sameField = new Map();
  for (const f of fields) {
    if (f.def.length < 20) continue; // `z.string()` alone is not worth sharing
    if (!sameField.has(f.def)) sameField.set(f.def, []);
    sameField.get(f.def).push(f);
  }
  report.schemas = {
    zodObjects: objects.length,
    inTarget: objects.filter((o) => targetFiles.has(o.file)).map((o) => `${o.at} {${o.keys.join(", ")}}`),
    sameKeySets: [...sameKeys].filter(([, l]) => l.length > 1 && inTarget(l)).map(([keys, l]) => ({ keys, places: l.map((o) => o.at) })).slice(0, TOP),
    overlapping: overlaps.sort((x, y) => y.overlap - x.overlap).slice(0, TOP),
    repeatedFieldDefinitions: [...sameField].filter(([, l]) => l.length > 2 && inTarget(l)).sort((a, b) => b[1].length - a[1].length).slice(0, TOP)
      .map(([def, l]) => ({ def, count: l.length, places: l.slice(0, 5).map((f) => f.at) })),
  };
}

// ---------------------------------------------------------------- wrappers that only forward, one-implementation types

if (SECTIONS.has("wrappers")) {
  const forwarders = [];
  const reexportOnly = [];
  for (const [file, sf] of sources) {
    if (!targetFiles.has(file) || isTest(file)) continue;
    const meaningful = sf.statements.filter((s) => !ts.isImportDeclaration(s) && !(ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression)));
    if (meaningful.length > 0 && meaningful.every((s) => ts.isExportDeclaration(s))) reexportOnly.push(rel(file));
    visit(sf, (node) => {
      if (!isFunctionLike(node) || !node.body || isTestCallback(node)) return;
      let expr = node.body;
      if (ts.isBlock(expr)) {
        if (expr.statements.length !== 1) return;
        const only = expr.statements[0];
        if (ts.isReturnStatement(only) && only.expression) expr = only.expression;
        else if (ts.isExpressionStatement(only)) expr = only.expression;
        else return;
      }
      while (ts.isAwaitExpression(expr) || ts.isParenthesizedExpression(expr)) expr = expr.expression;
      if (!ts.isCallExpression(expr)) return;
      const params = node.parameters.map((p) => p.name.getText(sf));
      const passed = expr.arguments.map((a) => a.getText(sf));
      const isPlain = (a) => params.includes(a);
      if (passed.length === 0 && params.length > 0) return;
      const exact = passed.length === params.length && passed.every((a, i) => a === params[i]);
      const mostlyPassThrough = params.length > 0 && params.every((p) => passed.includes(p)) && passed.filter((a) => !isPlain(a)).length <= 1;
      if (!exact && !mostlyPassThrough) return;
      // Callbacks passed inline (`onClick={() => save(id)}`, `.map((x) => f(x))`) are normal; only
      // report functions that are declared under a name of their own.
      const named = ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
        ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && (ts.isVariableDeclaration(node.parent) || ts.isPropertyAssignment(node.parent)));
      if (!named) return;
      const name = functionName(node);
      forwarders.push(`${where(node)} ${name}(${params.join(", ")}) → ${squash(expr.expression.getText(sf), 60)}(${squash(passed.join(", "), 40)})${exact ? "" : "  [adds an argument]"}`);
    });
  }

  // Interface-like types (two or more methods) and how many places implement them.
  const shapes = [];
  for (const [file, sf] of sources) {
    if (!targetFiles.has(file)) continue;
    for (const stmt of sf.statements) {
      const mods = ts.canHaveModifiers(stmt) ? ts.getModifiers(stmt) ?? [] : [];
      if (!mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
      const members = ts.isInterfaceDeclaration(stmt) ? stmt.members : ts.isTypeAliasDeclaration(stmt) && ts.isTypeLiteralNode(stmt.type) ? stmt.type.members : null;
      if (!members) continue;
      const methods = members.filter((m) => ts.isMethodSignature(m) || (ts.isPropertySignature(m) && m.type && ts.isFunctionTypeNode(m.type)));
      // Props and option bags are inputs, not seams with implementations.
      if (methods.length >= 2 && !/(Props|Options|Params|Args)$/.test(stmt.name.text)) shapes.push({ name: stmt.name.text, file, methods: methods.length });
    }
  }
  const implementations = shapes.map((shape) => {
    // `satisfies X`, `implements X`, `const x: X =`, and functions or methods declared to return X.
    const re = new RegExp(`(satisfies\\s+${shape.name}\\b|implements\\s+[\\w\\s,]*\\b${shape.name}\\b|:\\s*${shape.name}\\s*=|\\)\\s*:\\s*(Promise<)?${shape.name}\\s*[{>])`);
    const production = [];
    const tests = [];
    for (const [file, sf] of sources) {
      sf.text.split("\n").forEach((line, i) => { if (re.test(line)) (isTest(file) ? tests : production).push(`${rel(file)}:${i + 1}`); });
    }
    return { type: `${rel(shape.file)} ${shape.name} (${shape.methods} methods)`, production, tests };
  });
  report.wrappers = { forwarders: forwarders.slice(0, TOP * 2), reexportOnlyFiles: reexportOnly, interfaceImplementations: implementations };
}

// ---------------------------------------------------------------- tests: repeated vi.mock blocks

if (SECTIONS.has("tests")) {
  const mocks = new Map();
  for (const [file, sf] of sources) {
    if (!isTest(file)) continue;
    visit(sf, (node) => {
      if (!ts.isCallExpression(node) || node.expression.getText(sf) !== "vi.mock" || !node.arguments[0] || !ts.isStringLiteral(node.arguments[0])) return;
      const factory = node.arguments[1] ? squash(node.arguments[1].getText(sf), 80) : "(automock)";
      const key = `vi.mock("${node.arguments[0].text}", ${factory})`;
      if (!mocks.has(key)) mocks.set(key, []);
      mocks.get(key).push(file);
    });
  }
  // Route tests that re-check the 401 for an anonymous caller. `src/lib/http/route.test.ts` (withUser) and
  // `src/app/api/protected-routes.test.ts` (every API handler) already prove it.
  const anonymous = [];
  for (const [file, sf] of sources) {
    if (!isTest(file) || !/[\\/]app[\\/]api[\\/]/.test(file) || /protected-routes\.test/.test(file)) continue;
    visit(sf, (node) => {
      if (!ts.isCallExpression(node) || !/^(it|test)$/.test(node.expression.getText(sf))) return;
      const title = node.arguments[0];
      if (title && ts.isStringLiteralLike(title) && /anonymous|signed[- ]out|\b401\b|unauthori[sz]ed/i.test(title.text)) anonymous.push({ file, at: `${where(node)} "${squash(title.text, 60)}"` });
    });
  }
  report.anonymousRouteTests = { total: anonymous.length, inTarget: anonymous.filter((a) => targetFiles.has(a.file)).map((a) => a.at) };
  report.repeatedMocks = [...mocks].filter(([, files]) => files.length > 2 && files.some((f) => targetFiles.has(f))).sort((a, b) => b[1].length - a[1].length).slice(0, TOP)
    .map(([mock, files]) => ({ mock, count: files.length, files: files.slice(0, 4).map(rel) }));
}

// ---------------------------------------------------------------- output

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const out = [];
const h = (title, note) => out.push("", `## ${title}`, ...(note ? [`_${note}_`] : []), "");
const list = (items, empty = "Nothing found.") => {
  if (items.length === 0) return out.push(empty);
  const limit = TOP * 2;
  items.slice(0, limit).forEach((i) => out.push(`- ${i}`));
  if (items.length > limit) out.push(`- …and ${items.length - limit} more (raise --top, narrow the target, or use --json)`);
};

out.push(`# Repeated shapes in ${targets.join(", ")}`, "", `Target files: ${targetFiles.size}. Corpus: ${corpusFiles.length} files in ${CORPUS_DIR}. These are leads, not findings: read the code before proposing anything.`);

if (report.map) {
  h("Map", "Lines, exports, and who imports each target file. 'Never imported elsewhere' means no import, re-export, vi.mock or import() of that name was found in the corpus; grep before deleting.");
  for (const r of report.map) {
    out.push(`- **${r.file}** (${r.lines} lines) exports ${r.exports.length ? r.exports.join(", ") : "nothing"}; imported by ${r.importers} file(s)${r.testImporters ? ` (${r.testImporters} tests)` : ""}${r.importedBy.length ? `: ${r.importedBy.join(", ")}` : ""}`);
    if (r.unusedExports.length) out.push(`  - never imported elsewhere (dead, or only used in its own file): ${r.unusedExports.join(", ")}`);
  }
}
if (report.clones) {
  h("Function clones", `Functions with the same structure once names and literals are ignored (at least ${MIN_NODES} AST nodes). 'identical' means the text matches too.`);
  list(report.clones.map((g) => `${g.count}× ${g.nodes} nodes${g.identicalText ? ", identical" : ""}:\n${g.places.map((p) => `    - ${p}`).join("\n")}`));
}
if (report.sameName) {
  h("Same name, several files", "Top-level functions declared under the same name in more than one non-test file. Compare the bodies: some are one helper written twice, some are honest namesakes.");
  list(report.sameName, "None.");
}
if (report.similarFiles) {
  h("Near-duplicate files", `Token-shape similarity at or above ${THRESHOLD}, imports ignored. Line counts in brackets.`);
  list(report.similarFiles.map((p) => `${p.similarity}  ${p.a}  ~  ${p.b}`));
}
if (report.routes) {
  const r = report.routes;
  h("Route handlers", `${r.handlers} handlers in ${r.routeFiles} route files. Wrappers: ${Object.entries(r.wrappers).map(([k, v]) => `${k} ${v}`).join(", ")}. Shared modules (imported by a quarter or more of the routes): ${r.sharedModules.join(", ")}.`);
  out.push("Target handlers:");
  list(r.targetHandlers);
  out.push("", "Skeletons shared by more than one handler (wrapper | shared calls in order):");
  list(r.skeletons.map((s) => `${s.count}× ${s.skeleton}  e.g. ${s.examples.join("; ")}`));
  out.push("", "Handlers without a wrapper:");
  list(r.withoutWrapper, "None.");
  out.push("", "Hand-written `{ params: Promise<…> }` context types, across all routes (Next 16 generates a global `RouteContext<'/path/[id]'>`):");
  list(r.localContextTypes, "None.");
}
if (report.hooks) {
  const k = report.hooks;
  h("Data fetching and form state");
  out.push("SWR calls in the target:");
  list(k.swrCallsInTarget, "None.");
  out.push("", "The same SWR call made in more than one place:");
  list(k.swrKeysUsedMoreThanOnce.map((g) => `${g.count}× ${g.key}: ${g.places.join("; ")}`), "None.");
  out.push("", `fetch() calls in the target (${k.fetchCallsTotal} in the corpus):`);
  list(k.fetchCallsInTarget, "None.");
  out.push("", `Components keeping pending/error state by hand (${k.manualFormStateTotal} in the corpus; compare with src/hooks/use-api-form.ts):`);
  list(k.manualFormState, "None.");
  out.push("", "Hooks with the same name defined in more than one file:");
  list(k.hooksDefinedTwice.map((g) => `${g.key} ×${g.count}: ${g.places.join("; ")}`), "None.");
  out.push("", "Custom hooks in the target:");
  list(k.customHooksInTarget, "None.");
}
if (report.schemas) {
  const s = report.schemas;
  h("zod schemas", `${s.zodObjects} z.object calls in the corpus.`);
  out.push("In the target:");
  list(s.inTarget, "None.");
  out.push("", "Objects with exactly the same keys:");
  list(s.sameKeySets.map((g) => `{${g.keys}}: ${g.places.join("; ")}`), "None.");
  out.push("", "Objects that mostly overlap (candidates for .extend / .pick / .omit / .partial):");
  list(s.overlapping.map((o) => `${o.overlap}  ${o.a}  ~  ${o.b}  only first: [${o.onlyA.join(", ")}] only second: [${o.onlyB.join(", ")}]`), "None.");
  out.push("", "Field definitions written out three or more times:");
  list(s.repeatedFieldDefinitions.map((f) => `${f.count}× \`${f.def}\`: ${f.places.join("; ")}`), "None.");
}
if (report.wrappers) {
  const w = report.wrappers;
  h("Layers", "Named functions whose whole body forwards to one call, files that only re-export, and interface-like types with their implementations.");
  out.push("Forwarding functions:");
  list(w.forwarders, "None.");
  out.push("", "Re-export-only files:");
  list(w.reexportOnlyFiles, "None.");
  out.push("", "Interface-like types with two or more methods, and where they are implemented (app code includes src/app/dev previews):");
  list(w.interfaceImplementations.map((i) => `${i.type}: app code ${i.production.length ? i.production.join(", ") : "none found"}; tests and fakes ${i.tests.length ? i.tests.join(", ") : "none"}`), "None.");
}
if (report.testShapes || report.repeatedMocks) {
  h("Tests");
  if (report.testShapes) {
    out.push("Test cases in one file with the same structure (it.each candidates, or repeated cases):");
    list(report.testShapes.map((g) => `${g.count}× ${g.nodes} nodes${g.identicalText ? ", identical" : ""}:\n${g.places.map((p) => `    - ${p}`).join("\n")}`), "None.");
  }
  if (report.anonymousRouteTests) {
    out.push("", `Route tests re-checking the 401 for an anonymous caller (${report.anonymousRouteTests.total} in the corpus; withUser's own test and protected-routes.test.ts already prove it for every API handler; check each one is not about something route-specific, such as a bad bearer token):`);
    list(report.anonymousRouteTests.inTarget, "None in the target.");
  }
  if (report.repeatedMocks) {
    out.push("", "The same vi.mock written in three or more test files:");
    list(report.repeatedMocks.map((m) => `${m.count}× ${m.mock}  e.g. ${m.files.join(", ")}`), "None.");
  }
}
console.log(out.join("\n"));
