// Groups the raw inventory (collect.mjs) into features using features.json, works out the links
// between features, and lists everything no feature claims under `unassigned`.

import { matchName, matchPath, specificity } from "./lib/glob.mjs";

const TEST_KINDS = ["unit", "component", "page", "route", "db"];

/** The feature whose most specific pattern matches `value`, or null. */
function bestMatch(features, field, value, match) {
  let best = null;
  for (const [index, feature] of features.entries()) {
    for (const pattern of feature[field] ?? []) {
      if (!match(pattern, value)) continue;
      const score = specificity(pattern);
      if (!best || score > best.score || (score === best.score && index < best.index)) best = { feature, score, index, pattern };
    }
  }
  return best;
}



export function group(inventory, config) {
  const features = config.features;
  const ignored = [];

  // ── Files ────────────────────────────────────────────────────────────────────────────────────
  const fileFeature = new Map();
  const fileVia = new Map();
  const known = new Map(inventory.files.map((file) => [file.path, file]));
  for (const file of inventory.files) {
    if (file.kind === "migration") continue;
    const ignore = (config.ignore ?? []).find((entry) => matchPath(entry.path, file.path));
    if (ignore) {
      ignored.push({ path: file.path, reason: ignore.reason });
      continue;
    }
    let match = bestMatch(features, "paths", file.path, matchPath);
    let via = match ? `paths: ${match.pattern}` : null;
    if (!match && file.kind === "test") {
      // A test with no pattern of its own goes with the file it tests.
      const sibling = file.path.replace(/\.test(\.[cm]?[jt]sx?)$/, "$1");
      for (const candidate of [sibling, sibling.replace(/\.ts$/, ".tsx"), sibling.replace(/\.tsx$/, ".ts")]) {
        const siblingMatch = known.has(candidate) && bestMatch(features, "paths", candidate, matchPath);
        if (siblingMatch) {
          match = siblingMatch;
          via = `tests ${candidate}`;
          break;
        }
      }
    }
    if (match) {
      fileFeature.set(file.path, match.feature.id);
      fileVia.set(file.path, via);
    }
  }
  const featureOfFile = (path) => fileFeature.get(path) ?? null;

  // ── Database ─────────────────────────────────────────────────────────────────────────────────
  const tableFeature = new Map();
  for (const table of inventory.sql.tables) {
    const match = bestMatch(features, "tables", table.id, matchName);
    if (match) tableFeature.set(table.id, match.feature.id);
  }
  const functionFeature = new Map();
  const functionVia = new Map();
  const rpcCallers = new Map();
  for (const file of inventory.files) {
    for (const rpc of file.rpcs ?? []) {
      if (!rpcCallers.has(rpc)) rpcCallers.set(rpc, new Set());
      rpcCallers.get(rpc).add(file.path);
    }
  }
  const triggerTables = new Map();
  for (const table of inventory.sql.tables) {
    for (const trigger of table.triggers) {
      if (!triggerTables.has(trigger.fn)) triggerTables.set(trigger.fn, new Set());
      triggerTables.get(trigger.fn).add(table.id);
    }
  }
  for (const fn of inventory.sql.functions) {
    const match = bestMatch(features, "sqlFunctions", fn.id, matchName);
    if (match) {
      functionFeature.set(fn.id, match.feature.id);
      functionVia.set(fn.id, `sqlFunctions: ${match.pattern}`);
      continue;
    }
    // A trigger function belongs with the table it guards, when that is one feature's.
    const owners = new Set([...(triggerTables.get(fn.id) ?? [])].map((table) => tableFeature.get(table)).filter(Boolean));
    if (owners.size === 1) {
      functionFeature.set(fn.id, [...owners][0]);
      functionVia.set(fn.id, "trigger on its table");
      continue;
    }
    // An RPC belongs with the code that calls it, when that is one feature's (tests excluded).
    const callers = new Set([...(rpcCallers.get(fn.id) ?? [])].filter((path) => known.get(path)?.kind !== "test").map(featureOfFile).filter(Boolean));
    if (callers.size === 1) {
      functionFeature.set(fn.id, [...callers][0]);
      functionVia.set(fn.id, "called from that feature's code");
    }
  }
  const bucketFeature = new Map();
  for (const bucket of inventory.sql.buckets) {
    const match = bestMatch(features, "buckets", bucket.id, matchName);
    if (match) bucketFeature.set(bucket.id, match.feature.id);
  }

  // Which SQL test files mention each table and function.
  const testedBy = new Map();
  for (const test of inventory.sqlTests.filter((t) => t.kind === "sql-test")) {
    for (const id of [...test.tables, ...test.functions]) {
      if (!testedBy.has(id)) testedBy.set(id, []);
      testedBy.get(id).push(test.file);
    }
  }

  // Code that reads each table or calls each RPC (tests excluded).
  const usedByCode = new Map();
  const noteUse = (id, path) => {
    if (!usedByCode.has(id)) usedByCode.set(id, new Set());
    usedByCode.get(id).add(path);
  };
  for (const file of inventory.files) {
    if (file.kind === "test") continue;
    for (const table of file.tables ?? []) noteUse(table, file.path);
    for (const rpc of file.rpcs ?? []) noteUse(rpc, file.path);
  }

  // ── Links ────────────────────────────────────────────────────────────────────────────────────
  const links = new Map();
  const link = (from, to, kind, evidence) => {
    if (!from || !to || from === to) return;
    const key = `${from}→${to}`;
    if (!links.has(key)) links.set(key, { from, to, kinds: {}, examples: [] });
    const entry = links.get(key);
    entry.kinds[kind] = (entry.kinds[kind] ?? 0) + 1;
    if (entry.examples.length < 6 && !entry.examples.includes(evidence)) entry.examples.push(evidence);
  };
  for (const file of inventory.files) {
    if (file.kind === "test" || file.kind === "test-support") continue;
    const from = featureOfFile(file.path);
    for (const target of file.imports ?? []) {
      const kind = (file.typeOnlyImports ?? []).includes(target) ? "types" : "imports";
      link(from, featureOfFile(target), kind, `${file.path} imports ${target}`);
    }
    for (const table of file.tables ?? []) link(from, tableFeature.get(table), "db", `${file.path} reads/writes table ${table}`);
    for (const rpc of file.rpcs ?? []) link(from, functionFeature.get(rpc), "db", `${file.path} calls ${rpc}()`);
  }
  for (const route of inventory.apiRoutes) {
    for (const caller of route.calledFrom) link(featureOfFile(caller), featureOfFile(route.file), "api", `${caller} calls ${route.route}`);
  }
  for (const fn of inventory.sql.functions) {
    const from = functionFeature.get(fn.id);
    for (const table of fn.references.tables) link(from, tableFeature.get(table), "sql", `function ${fn.id} uses table ${table}`);
    for (const other of fn.references.functions) link(from, functionFeature.get(other), "sql", `function ${fn.id} calls ${other}()`);
  }
  for (const table of inventory.sql.tables) {
    const from = tableFeature.get(table.id);
    for (const policy of table.policies) {
      for (const other of policy.references.tables) link(from, tableFeature.get(other), "sql", `policy ${policy.name} on ${table.id} reads ${other}`);
      for (const fn of policy.references.functions) link(from, functionFeature.get(fn), "sql", `policy ${policy.name} on ${table.id} calls ${fn}()`);
    }
    // A trigger belongs to whoever owns its function: that feature hooks into this table.
    for (const trigger of table.triggers) link(functionFeature.get(trigger.fn), from, "sql", `trigger ${trigger.name} (${trigger.fn}()) fires on table ${table.id}`);
  }
  const jobs = inventory.workerJobs.map((job) => {
    const owner = featureOfFile(job.file);
    const touches = new Set();
    for (const table of job.tables) if (tableFeature.get(table)) touches.add(tableFeature.get(table));
    for (const rpc of job.rpcs) if (functionFeature.get(`public.${rpc}`)) touches.add(functionFeature.get(`public.${rpc}`));
    for (const feature of touches) link(owner, feature, "worker", `worker job ${job.name} uses ${feature}`);
    return { ...job, owner, features: [...touches].sort() };
  });

  // ── Per feature ──────────────────────────────────────────────────────────────────────────────
  const describeRoute = (route) => ({
    route: route.route,
    file: route.file,
    methods: route.methods,
    familyFlag: route.guards.includes("requireFamilyFeature"),
    guards: route.guards,
    runtime: route.runtime,
    calledFrom: route.calledFrom.map((path) => ({ file: path, feature: featureOfFile(path) })),
  });

  const result = features.map((feature) => {
    const files = inventory.files.filter((file) => featureOfFile(file.path) === feature.id);
    const ownFiles = new Set(files.map((file) => file.path));
    const pages = inventory.pages.filter((page) => ownFiles.has(page.file));
    const apiRoutes = inventory.apiRoutes.filter((route) => ownFiles.has(route.file)).map(describeRoute);
    const tables = inventory.sql.tables.filter((table) => tableFeature.get(table.id) === feature.id).map((table) => ({
      ...table,
      testedBy: testedBy.get(table.id) ?? [],
      usedBy: [...(usedByCode.get(table.id) ?? [])].sort(),
    }));
    const functions = inventory.sql.functions.filter((fn) => functionFeature.get(fn.id) === feature.id).map((fn) => ({
      ...fn,
      via: functionVia.get(fn.id),
      calledFrom: [...(rpcCallers.get(fn.id) ?? [])].filter((path) => known.get(path)?.kind !== "test").sort(),
      triggerOn: [...(triggerTables.get(fn.id) ?? [])],
      testedBy: testedBy.get(fn.id) ?? [],
    }));
    const testFiles = files.filter((file) => file.kind === "test").map((file) => ({ file: file.path, kind: file.testKind, cases: file.testCases ?? 0 }));
    const sqlTests = inventory.sqlTests
      .filter((test) => test.kind === "sql-test" && ownFiles.has(test.file))
      .map((test) => ({ file: test.file, kind: "db", cases: test.tests, description: test.description, counted: test.counted }));
    const allTests = [...testFiles, ...sqlTests];
    const testTotals = Object.fromEntries(TEST_KINDS.map((kind) => {
      const of = allTests.filter((test) => test.kind === kind);
      return [kind, { files: of.length, cases: of.reduce((sum, test) => sum + test.cases, 0) }];
    }));
    testTotals.all = { files: allTests.length, cases: allTests.reduce((sum, test) => sum + test.cases, 0) };

    // Components and hooks from other features that this feature's code imports.
    const borrowed = new Map();
    for (const file of files) {
      if (file.kind === "test") continue;
      for (const target of file.imports ?? []) {
        const record = known.get(target);
        const owner = featureOfFile(target);
        if (!record || owner === feature.id || !["component", "hook"].includes(record.kind)) continue;
        if (!borrowed.has(target)) borrowed.set(target, { file: target, kind: record.kind, feature: owner, usedBy: [] });
        borrowed.get(target).usedBy.push(file.path);
      }
    }

    const envVars = inventory.envVars
      .map((env) => ({ name: env.name, files: env.usedIn.filter((path) => ownFiles.has(path)), inEnvExample: env.inEnvExample }))
      .filter((env) => env.files.length);
    const flags = inventory.flags
      .map((flag) => {
        const uses = flag.usedIn.filter((use) => ownFiles.has(use.file) && known.get(use.file)?.kind !== "test");
        return { name: flag.name, env: flag.env, files: uses.map((use) => use.file), via: [...new Set(uses.flatMap((use) => use.via))] };
      })
      .filter((flag) => flag.files.length);

    const policies = tables.flatMap((table) => table.policies);
    const migrations = [...new Set([...tables.flatMap((t) => t.migrations), ...functions.flatMap((f) => f.migrations)])].sort();

    return {
      id: feature.id,
      name: feature.name,
      kind: feature.kind ?? "feature",
      diagram: feature.diagram ?? (feature.kind ?? "feature") === "feature",
      summary: feature.summary ?? "",
      docs: feature.docs ?? [],
      stats: {
        files: files.length,
        lines: files.reduce((sum, file) => sum + file.lines, 0),
        pages: pages.length,
        apiRoutes: apiRoutes.length,
        tables: tables.length,
        functions: functions.length,
        policies: policies.length,
        mcpTools: 0,
        workerJobs: 0,
        tests: testTotals.all,
      },
      pages,
      navEntries: pages.map((page) => page.nav).filter(Boolean),
      apiRoutes,
      lib: files.filter((file) => file.kind === "lib").map((file) => ({ file: file.path, role: file.role, description: file.description })),
      components: files.filter((file) => file.kind === "component").map((file) => ({ file: file.path, description: file.description })),
      hooks: files.filter((file) => file.kind === "hook").map((file) => ({ file: file.path, description: file.description })),
      otherFiles: files
        .filter((file) => !["lib", "component", "hook", "page", "route", "test", "sql-test"].includes(file.kind))
        .map((file) => ({ file: file.path, kind: file.kind, description: file.description ?? null })),
      borrowed: [...borrowed.values()].sort((a, b) => a.file.localeCompare(b.file)),
      tables,
      functions,
      buckets: inventory.sql.buckets.filter((bucket) => bucketFeature.get(bucket.id) === feature.id),
      migrations,
      mcpTools: inventory.mcpTools.filter((tool) => ownFiles.has(tool.file)),
      workerJobs: jobs.filter((job) => job.owner === feature.id || job.features.includes(feature.id)),
      flags,
      envVars,
      tests: allTests,
      testTotals,
      fileVia: Object.fromEntries(files.map((file) => [file.path, fileVia.get(file.path)])),
    };
  });
  for (const feature of result) {
    feature.stats.mcpTools = feature.mcpTools.length;
    feature.stats.workerJobs = feature.workerJobs.length;
  }

  const linkList = [...links.values()].map((entry) => ({
    ...entry,
    weight: Object.entries(entry.kinds).reduce((sum, [kind, count]) => sum + (kind === "types" ? 0.25 : 1) * count, 0),
  })).sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  for (const feature of result) {
    feature.dependsOn = linkList.filter((l) => l.from === feature.id).map((l) => ({ feature: l.to, kinds: l.kinds, examples: l.examples }));
    feature.usedBy = linkList.filter((l) => l.to === feature.id).map((l) => ({ feature: l.from, kinds: l.kinds, examples: l.examples }));
  }

  // ── Unassigned ───────────────────────────────────────────────────────────────────────────────
  const ignoredPaths = new Set(ignored.map((entry) => entry.path));
  const unassigned = {
    files: inventory.files
      .filter((file) => file.kind !== "migration" && !fileFeature.has(file.path) && !ignoredPaths.has(file.path))
      .map((file) => ({ file: file.path, kind: file.kind, description: file.description ?? null })),
    tables: inventory.sql.tables.filter((table) => !tableFeature.has(table.id)).map((table) => ({ id: table.id, createdIn: table.createdIn, external: table.external })),
    functions: inventory.sql.functions.filter((fn) => !functionFeature.has(fn.id)).map((fn) => ({ id: fn.id, createdIn: fn.createdIn, legacy: fn.legacy, external: fn.external, comment: fn.comment })),
    buckets: inventory.sql.buckets.filter((bucket) => !bucketFeature.has(bucket.id)),
    envVars: inventory.envVars
      .filter((env) => !env.usedIn.some((path) => fileFeature.has(path)))
      .map((env) => ({ name: env.name, inEnvExample: env.inEnvExample, usedIn: env.usedIn, note: env.usedIn.length ? "read only by unassigned files" : "not read anywhere in src/" })),
    mcpTools: inventory.mcpTools.filter((tool) => !fileFeature.has(tool.file)),
    workerJobs: jobs.filter((job) => !job.owner && job.features.length === 0),
  };
  unassigned.count = Object.values(unassigned).reduce((sum, list) => sum + list.length, 0);

  const totals = {
    features: result.filter((f) => f.kind === "feature").length,
    infrastructure: result.filter((f) => f.kind !== "feature").length,
    files: inventory.files.length,
    pages: inventory.pages.length,
    apiRoutes: inventory.apiRoutes.length,
    tables: inventory.sql.tables.filter((t) => !t.external).length,
    functions: inventory.sql.functions.filter((f) => !f.external).length,
    policies: inventory.sql.tables.reduce((sum, t) => sum + t.policies.length, 0),
    migrations: inventory.sql.migrations.filter((m) => !m.legacy).length,
    mcpTools: inventory.mcpTools.length,
    workerJobs: inventory.workerJobs.length,
    envVars: inventory.envVars.length,
    testFiles: result.reduce((sum, f) => sum + f.testTotals.all.files, 0),
    testCases: result.reduce((sum, f) => sum + f.testTotals.all.cases, 0),
    unassigned: unassigned.count,
  };

  return {
    generatedAt: inventory.generatedAt,
    testCountSource: inventory.testCountSource ?? "static",
    totals,
    features: result,
    links: linkList,
    nav: inventory.nav,
    flags: inventory.flags,
    envVars: inventory.envVars.map((env) => ({ ...env, features: [...new Set(env.usedIn.map(featureOfFile).filter(Boolean))] })),
    mcpTools: inventory.mcpTools.map((tool) => ({ ...tool, feature: featureOfFile(tool.file) })),
    workerJobs: jobs,
    schemas: inventory.sql.schemas,
    migrations: inventory.sql.migrations,
    unassigned,
    ignored,
    featureName: Object.fromEntries(features.map((f) => [f.id, f.name])),
  };
}


