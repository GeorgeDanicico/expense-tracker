// Client script for feature-map.html. Reads the embedded model and renders the feature list,
// details, search, dependency diagram and unassigned list.
(function () {
  "use strict";
  const model = JSON.parse(document.getElementById("data").textContent);
  const features = model.features;
  const byId = new Map(features.map((f) => [f.id, f]));
  const name = (id) => (byId.get(id) ? byId.get(id).name : id || "Unassigned");
  const $ = (selector) => document.querySelector(selector);

  const esc = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const short = (path) => String(path || "").replace(/^src\//, "");
  const code = (value) => (value ? `<code>${esc(value)}</code>` : "");
  const table = (headers, rows) =>
    rows.length
      ? `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((row) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`)
          .join("")}</tbody></table></div>`
      : "";
  const featureLink = (id) => (id ? `<button type="button" class="linkbtn" data-open="${esc(id)}">${esc(name(id))}</button>` : "<em>unassigned</em>");
  const KIND_LABEL = { imports: "imports", types: "type imports", api: "API calls", db: "database calls", sql: "SQL references", worker: "worker jobs" };
  const kinds = (k) => Object.entries(k).map(([kind, n]) => `${KIND_LABEL[kind] || kind} ${n}`).join(", ");

  // ── Theme ───────────────────────────────────────────────────────────────────────────────────
  const root = document.documentElement;
  try {
    const saved = localStorage.getItem("feature-map-theme");
    if (saved) root.dataset.theme = saved;
  } catch (e) { /* storage unavailable */ }
  $("#theme").addEventListener("click", () => {
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("feature-map-theme", root.dataset.theme); } catch (e) { /* ignore */ }
  });

  // ── Header ──────────────────────────────────────────────────────────────────────────────────
  const t = model.totals;
  $("#totals").textContent =
    `${t.features} features + ${t.infrastructure} infrastructure · ${t.pages} pages · ${t.apiRoutes} routes · ${t.tables} tables · ` +
    `${t.functions} SQL functions · ${t.mcpTools} MCP tools · ${t.workerJobs} worker jobs · ${t.testCases.toLocaleString("en-US")} test cases · ` +
    `generated ${new Date(model.generatedAt).toLocaleString()}`;
  $("#unassigned-count").textContent = String(t.unassigned);

  // ── Views ───────────────────────────────────────────────────────────────────────────────────
  let view = "features";
  function show(next) {
    view = next;
    const searching = $("#search").value.trim().length > 0;
    for (const button of document.querySelectorAll(".tabs button")) button.classList.toggle("active", button.dataset.view === next && !searching);
    $("#view-features").hidden = next !== "features" || searching;
    $("#view-search").hidden = !searching;
    $("#view-diagram").hidden = next !== "diagram" || searching;
    $("#view-unassigned").hidden = next !== "unassigned" || searching;
    if (next === "diagram" && !searching) drawDiagram();
  }
  for (const button of document.querySelectorAll(".tabs button")) {
    button.addEventListener("click", () => {
      $("#search").value = "";
      show(button.dataset.view);
    });
  }

  // ── Feature list and detail ─────────────────────────────────────────────────────────────────
  let current = features[0] && features[0].id;
  function renderList() {
    const kindsOn = new Set([...document.querySelectorAll("#kind-filter input:checked")].map((i) => i.value));
    $("#feature-list").innerHTML = features
      .filter((f) => kindsOn.has(f.kind))
      .map(
        (f) =>
          `<li><button type="button" data-open="${esc(f.id)}" class="${f.id === current ? "active" : ""}"><span>${esc(f.name)}${
            f.kind === "infrastructure" ? ' <span class="infra-tag">· infra</span>' : ""
          }</span><span class="muted">${f.stats.files}</span></button></li>`,
      )
      .join("");
  }
  for (const input of document.querySelectorAll("#kind-filter input")) input.addEventListener("change", renderList);

  function routeAccess(route) {
    const parts = route.methods.map((m) =>
      `${m.method}: ${m.auth === "withPermission" ? `withPermission(${m.permission && m.permission.module}, ${m.permission && m.permission.level})` : m.auth}`,
    );
    if (route.familyFlag) parts.push("family flag");
    return esc(parts.join("; "));
  }

  function renderDetail(id) {
    const f = byId.get(id);
    if (!f) return;
    current = id;
    const s = f.stats;
    const tt = f.testTotals;
    const stat = (label, value) => `<div class="stat"><b>${esc(value)}</b><span class="muted">${esc(label)}</span></div>`;
    let html = `<h2>${esc(f.name)} <span class="kind ${esc(f.kind)}">${esc(f.kind)}</span></h2><p>${esc(f.summary)}</p>`;
    if (f.docs.length) html += `<p class="muted">Docs: ${f.docs.map(code).join(", ")}</p>`;
    html += `<div class="stats">${[
      stat("files", s.files), stat("lines", s.lines.toLocaleString("en-US")), stat("pages", s.pages), stat("routes", s.apiRoutes),
      stat("tables", s.tables), stat("SQL functions", s.functions), stat("RLS policies", s.policies), stat("MCP tools", s.mcpTools),
      stat("worker jobs", s.workerJobs), stat("test cases", s.tests.cases),
    ].join("")}</div>`;
    html += `<p class="muted">Tests: ${["unit", "component", "page", "route", "db"].filter((k) => tt[k].files).map((k) => `${k} ${tt[k].cases} in ${tt[k].files} files`).join(", ") || "none"}</p>`;

    if (f.pages.length) {
      html += "<h3>Pages</h3>" + table(["Route", "Group", "Navigation", "Access", "File"], f.pages.map((p) => [
        code(p.route), esc(p.group),
        p.nav ? esc(`${p.nav.place}: "${p.nav.label}"${p.nav.section ? ` (${p.nav.section})` : ""}${p.nav.mobileTabBar ? ", tab bar" : ""}${p.nav.requiresFamily ? ", family only" : ""}`) : "none",
        esc([p.permissionGate.length ? `PermissionGate(${p.permissionGate.join(", ")})` : "", p.devOnly ? "dev only" : ""].filter(Boolean).join("; ") || "-"),
        code(short(p.file)),
      ]));
    }
    if (f.apiRoutes.length) {
      html += "<h3>API routes</h3>" + table(["Route", "Access", "Called from", "File"], f.apiRoutes.map((r) => [
        code(r.route), routeAccess(r),
        r.calledFrom.length ? r.calledFrom.map((c) => `${code(short(c.file).split("/").pop())}${c.feature !== f.id ? ` (${esc(name(c.feature))})` : ""}`).join(", ") : '<span class="muted">not called from app code</span>',
        code(short(r.file)),
      ]));
    }
    if (f.lib.length) html += "<h3>Library modules</h3>" + table(["Module", "Role", "What it does"], f.lib.map((l) => [code(short(l.file)), esc(l.role), esc(l.description || "")]));
    if (f.components.length) html += `<h3>Components (${f.components.length})</h3><div class="taglist">${f.components.map((c) => `<span class="tag mono" title="${esc(c.description || "")}">${esc(short(c.file).replace(/^components\//, ""))}</span>`).join("")}</div>`;
    if (f.hooks.length) html += `<h3>Hooks</h3><div class="taglist">${f.hooks.map((h) => `<span class="tag mono" title="${esc(h.description || "")}">${esc(short(h.file))}</span>`).join("")}</div>`;
    if (f.borrowed.length) html += `<h3>Components and hooks used from other features</h3><div class="taglist">${f.borrowed.map((b) => `<span class="tag mono">${esc(short(b.file).replace(/^(components|hooks)\//, ""))} · ${esc(name(b.feature))}</span>`).join("")}</div>`;
    if (f.otherFiles.length) html += `<h3>Other files</h3><div class="taglist">${f.otherFiles.map((o) => `<span class="tag mono">${esc(short(o.file))} (${esc(o.kind)})</span>`).join("")}</div>`;
    if (f.tables.length) {
      html += "<h3>Tables</h3>" + table(["Table", "RLS", "Policies", "Triggers", "Tested by"], f.tables.map((tb) => [
        `${code(tb.id)}${tb.comment ? `<br><span class="muted">${esc(tb.comment)}</span>` : ""}`,
        tb.external ? "Supabase" : tb.rls ? "on" : '<span class="off">off</span>',
        esc(tb.policies.map((p) => `${p.name} (${p.command})`).join(", ") || "none"),
        esc(tb.triggers.map((x) => `${x.name} → ${x.fn}()`).join(", ") || "none"),
        esc(tb.testedBy.map((x) => x.replace("supabase/tests/", "")).join(", ") || "no SQL test"),
      ]));
    }
    if (f.functions.length) {
      html += "<h3>SQL functions</h3>" + table(["Function", "Kind", "Called from", "Tested by"], f.functions.map((fn) => [
        `${code(fn.id + "()")}${fn.comment ? `<br><span class="muted">${esc(fn.comment)}</span>` : ""}`,
        esc([fn.returnsTrigger ? "trigger" : "function", fn.securityDefiner ? "security definer" : "", fn.legacy ? "legacy" : ""].filter(Boolean).join(", ")),
        esc(fn.calledFrom.length ? fn.calledFrom.map((p) => short(p).split("/").pop()).join(", ") : fn.triggerOn.length ? `trigger on ${fn.triggerOn.join(", ")}` : "SQL only"),
        esc(fn.testedBy.map((x) => x.replace("supabase/tests/", "")).join(", ") || "no SQL test"),
      ]));
    }
    if (f.buckets.length) html += `<h3>Storage buckets</h3>${f.buckets.map((b) => code(b.id)).join(", ")}`;
    if (f.mcpTools.length) html += "<h3>MCP tools</h3>" + table(["Tool", "Access", "Permission module", "Only while"], f.mcpTools.map((tool) => [code(tool.name), esc(tool.access || ""), esc(tool.module || "none"), esc(tool.gatedBy ? tool.gatedBy + "()" : "always")]));
    if (f.workerJobs.length) html += "<h3>Worker jobs</h3>" + table(["Job", "What it does", "Tables and RPCs", "Features"], f.workerJobs.map((j) => [code(j.name), esc(j.description || ""), esc([...j.tables, ...j.rpcs.map((r) => r + "()")].join(", ")), j.features.map(featureLink).join(", ")]));
    if (f.flags.length || f.envVars.length) {
      html += "<h3>Flags and environment</h3><ul>" +
        f.flags.map((fl) => `<li>Flag ${code(fl.env.join(", "))} via ${fl.via.map((v) => code(v + "()")).join(", ")} in ${fl.files.length} files</li>`).join("") +
        f.envVars.map((e) => `<li>Env ${code(e.name)} read in ${e.files.map((x) => code(short(x))).join(", ")}</li>`).join("") + "</ul>";
    }
    if (f.tests.length) html += `<h3>Tests</h3><details><summary>${f.tests.length} test files, ${s.tests.cases} cases</summary>${table(["File", "Kind", "Cases"], f.tests.map((x) => [code(short(x.file)), esc(x.kind), esc(x.cases)]))}</details>`;
    if (f.dependsOn.length || f.usedBy.length) {
      html += "<h3>Links</h3>";
      const linkRows = (list, label) => list.map((d) => [label, featureLink(d.feature), esc(kinds(d.kinds)), `<details><summary>examples</summary>${d.examples.map((x) => `<div class="mono">${esc(x)}</div>`).join("")}</details>`]);
      html += table(["Direction", "Feature", "Evidence", ""], [...linkRows(f.dependsOn, "depends on"), ...linkRows(f.usedBy, "used by")]);
    }
    $("#detail").innerHTML = html;
    renderList();
  }

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-open]");
    if (!target) return;
    $("#search").value = "";
    show("features");
    renderDetail(target.dataset.open);
    window.scrollTo({ top: 0 });
  });

  // ── Search ──────────────────────────────────────────────────────────────────────────────────
  const items = [];
  const add = (type, label, detail, feature) => items.push({ type, label, detail: detail || "", feature, text: `${label} ${detail || ""}`.toLowerCase() });
  for (const f of features) {
    for (const p of f.pages) add("Pages", p.route, short(p.file), f.id);
    for (const r of f.apiRoutes) add("API routes", `${r.methods.map((m) => m.method).join(",")} ${r.route}`, short(r.file), f.id);
    for (const l of f.lib) add("Files", short(l.file), l.description, f.id);
    for (const c of [...f.components, ...f.hooks]) add("Files", short(c.file), c.description, f.id);
    for (const o of f.otherFiles) add("Files", short(o.file), o.kind, f.id);
    for (const tb of f.tables) {
      add("Tables", tb.id, tb.comment, f.id);
      for (const p of tb.policies) add("RLS policies", p.name, `${p.command} on ${tb.id}`, f.id);
    }
    for (const fn of f.functions) add("SQL functions", fn.id + "()", fn.comment, f.id);
    for (const tool of f.mcpTools) add("MCP tools", tool.name, tool.title, f.id);
    for (const x of f.tests) add("Tests", short(x.file), `${x.kind}, ${x.cases} cases`, f.id);
    for (const e of f.envVars) add("Env vars", e.name, e.files.map(short).join(", "), f.id);
  }
  for (const job of model.workerJobs) add("Worker jobs", job.name, job.description, job.owner);
  const types = [...new Set(items.map((i) => i.type))];
  $("#type-filter").innerHTML = types.map((type) => `<label><input type="checkbox" value="${esc(type)}" checked> ${esc(type)}</label>`).join("");

  function highlight(text, query) {
    const value = esc(text);
    if (!query) return value;
    const at = value.toLowerCase().indexOf(esc(query).toLowerCase());
    return at === -1 ? value : `${value.slice(0, at)}<mark>${value.slice(at, at + esc(query).length)}</mark>${value.slice(at + esc(query).length)}`;
  }
  function runSearch() {
    const query = $("#search").value.trim().toLowerCase();
    show(view);
    if (!query) return;
    const on = new Set([...document.querySelectorAll("#type-filter input:checked")].map((i) => i.value));
    const words = query.split(/\s+/);
    const found = items.filter((i) => on.has(i.type) && words.every((w) => i.text.includes(w)));
    const groups = types.map((type) => [type, found.filter((i) => i.type === type)]).filter(([, list]) => list.length);
    $("#results").innerHTML = groups.length
      ? groups.map(([type, list]) => `<div class="group card"><h3>${esc(type)} (${list.length})</h3>${table(["Item", "Feature", "Detail"], list.slice(0, 200).map((i) => [
          `<span class="mono">${highlight(i.label, words[0])}</span>`, featureLink(i.feature), `<span class="muted">${highlight(i.detail, words[0])}</span>`,
        ]))}</div>`).join("")
      : '<p class="muted">Nothing matches.</p>';
  }
  $("#search").addEventListener("input", runSearch);
  for (const input of document.querySelectorAll("#type-filter input")) input.addEventListener("change", runSearch);

  // ── Diagram ─────────────────────────────────────────────────────────────────────────────────
  const SVG = "http://www.w3.org/2000/svg";
  function drawDiagram() {
    const showInfra = $("#show-infra").checked;
    const showTypes = $("#show-types").checked;
    const nodes = features.filter((f) => f.diagram || showInfra);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = model.links.filter((l) => ids.has(l.from) && ids.has(l.to) && (showTypes || Object.keys(l.kinds).some((k) => k !== "types")));

    // Order nodes around the circle so linked features sit near each other: start with the most
    // connected node, then repeatedly add the node most strongly linked to the last few placed.
    const weight = (a, b) => edges.filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a)).reduce((sum, e) => sum + e.weight, 0);
    const degree = (id) => edges.filter((e) => e.from === id || e.to === id).reduce((sum, e) => sum + e.weight, 0);
    const left = nodes.map((n) => n.id).sort((a, b) => degree(b) - degree(a));
    const order = [left.shift()];
    while (left.length) {
      const recent = order.slice(-3);
      left.sort((a, b) => recent.reduce((s, r, i) => s + weight(b, r) * (i + 1), 0) - recent.reduce((s, r, i) => s + weight(a, r) * (i + 1), 0));
      order.push(left.shift());
    }

    // An ellipse wide enough that neighbouring boxes at the top and bottom never overlap.
    const boxW = 150;
    const boxH = 30;
    const rx = Math.max(380, (order.length * (boxW + 20)) / (2 * Math.PI));
    const ry = Math.max(220, rx * 0.62);
    const width = 2 * rx + boxW + 40;
    const height = 2 * ry + boxH + 60;
    const cx = width / 2;
    const cy = height / 2;
    const position = new Map(order.map((id, i) => {
      const angle = (i / order.length) * Math.PI * 2 - Math.PI / 2;
      return [id, { x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle) }];
    }));

    const svg = $("#diagram");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.innerHTML = "";
    const defs = document.createElementNS(SVG, "defs");
    defs.innerHTML = ["arrow", "arrow-hot"].map((id) => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"></path></marker>`).join("");
    svg.appendChild(defs);

    const edgeLayer = document.createElementNS(SVG, "g");
    const nodeLayer = document.createElementNS(SVG, "g");
    svg.append(edgeLayer, nodeLayer);
    const clip = (from, to) => {
      // Stop the line at the target box's edge.
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const scale = Math.min(Math.abs((boxW / 2 + 4) / (dx || 1e-6)), Math.abs((boxH / 2 + 4) / (dy || 1e-6)), 1);
      return { x: to.x - dx * scale, y: to.y - dy * scale };
    };
    const edgeEls = edges.map((e) => {
      const a = position.get(e.from);
      const b = position.get(e.to);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const control = { x: mid.x + (cx - mid.x) * 0.35, y: mid.y + (cy - mid.y) * 0.35 };
      const end = clip(control, b);
      const start = clip(control, a);
      const path = document.createElementNS(SVG, "path");
      path.setAttribute("d", `M${start.x},${start.y} Q${control.x},${control.y} ${end.x},${end.y}`);
      const strong = ["imports", "api", "db"].some((k) => e.kinds[k]);
      path.setAttribute("class", `edge${strong ? "" : " weak"}`);
      path.setAttribute("stroke-width", String(Math.min(1 + Math.log2(1 + e.weight), 5)));
      path.setAttribute("marker-end", "url(#arrow)");
      const title = document.createElementNS(SVG, "title");
      title.textContent = `${name(e.from)} → ${name(e.to)}: ${kinds(e.kinds)}`;
      path.appendChild(title);
      path.addEventListener("mouseenter", () => { $("#edge-info").textContent = title.textContent; });
      edgeLayer.appendChild(path);
      return { e, path };
    });

    for (const id of order) {
      const f = byId.get(id);
      const p = position.get(id);
      const g = document.createElementNS(SVG, "g");
      g.setAttribute("class", `node ${f.kind}`);
      g.setAttribute("transform", `translate(${p.x - boxW / 2},${p.y - boxH / 2})`);
      g.setAttribute("tabindex", "0");
      g.dataset.open = id;
      const label = f.name.length > 22 ? f.name.slice(0, 21) + "…" : f.name;
      g.innerHTML = `<rect width="${boxW}" height="${boxH}" rx="${f.kind === "feature" ? 6 : 15}"></rect><text x="${boxW / 2}" y="${boxH / 2 + 4}" text-anchor="middle">${esc(label)}</text><title>${esc(f.name)}</title>`;
      const focus = (on) => {
        const linked = new Set([id]);
        for (const { e, path } of edgeEls) {
          const hot = e.from === id || e.to === id;
          if (hot) { linked.add(e.from); linked.add(e.to); }
          path.classList.toggle("hot", on && hot);
          path.classList.toggle("cold", on && !hot);
          path.setAttribute("marker-end", on && hot ? "url(#arrow-hot)" : "url(#arrow)");
        }
        for (const node of nodeLayer.children) {
          node.classList.toggle("hot", on && node.dataset.open === id);
          node.classList.toggle("cold", on && !linked.has(node.dataset.open));
        }
        const f2 = byId.get(id);
        $("#edge-info").textContent = on
          ? `${f2.name} depends on: ${f2.dependsOn.map((d) => name(d.feature)).join(", ") || "nothing"} · used by: ${f2.usedBy.map((d) => name(d.feature)).join(", ") || "nothing"}`
          : "";
      };
      g.addEventListener("mouseenter", () => focus(true));
      g.addEventListener("mouseleave", () => focus(false));
      g.addEventListener("focus", () => focus(true));
      g.addEventListener("blur", () => focus(false));
      g.addEventListener("keydown", (event) => { if (event.key === "Enter") g.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      nodeLayer.appendChild(g);
    }
  }
  $("#show-infra").addEventListener("change", drawDiagram);
  $("#show-types").addEventListener("change", drawDiagram);

  // ── Unassigned ──────────────────────────────────────────────────────────────────────────────
  function renderUnassigned() {
    const u = model.unassigned;
    const rows = [
      ...u.files.map((x) => ["File", code(x.file), esc(x.kind + (x.description ? `: ${x.description}` : ""))]),
      ...u.tables.map((x) => ["Table", code(x.id), esc(x.createdIn || "")]),
      ...u.functions.map((x) => ["SQL function", code(x.id + "()"), esc(x.legacy ? "legacy: predates the migrations; stubbed in legacy-bootstrap.sql, unused by the app" : x.createdIn || "")]),
      ...u.buckets.map((x) => ["Storage bucket", code(x.id), ""]),
      ...u.envVars.map((x) => ["Env var", code(x.name), esc(x.note)]),
      ...u.mcpTools.map((x) => ["MCP tool", code(x.name), code(x.file)]),
      ...u.workerJobs.map((x) => ["Worker job", code(x.name), esc(x.description || "")]),
    ];
    $("#view-unassigned").innerHTML = `<div class="card"><h2>Unassigned (${u.count})</h2><p class="muted">Items no feature in features.json claims. Add a pattern for each, or leave it if it really belongs nowhere.</p>${
      rows.length ? table(["Type", "Item", "Note"], rows) : "<p>Nothing unassigned.</p>"
    }${model.ignored.length ? `<h3>Deliberately ignored</h3>${table(["Path", "Reason"], model.ignored.map((x) => [code(x.path), esc(x.reason)]))}` : ""}</div>`;
  }

  renderList();
  renderDetail(current);
  renderUnassigned();
  show("features");
})();
