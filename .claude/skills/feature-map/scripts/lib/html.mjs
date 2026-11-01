// Builds the self-contained feature-map.html: page.css and page.js inlined, the model embedded as
// JSON. No external requests.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The model without the per-file pattern provenance, which the page doesn't show. */
function pageData(model) {
  return {
    ...model,
    features: model.features.map(({ fileVia, ...feature }) => feature),
  };
}

export function htmlPage(model) {
  const css = readFileSync(join(HERE, "page.css"), "utf8");
  const js = readFileSync(join(HERE, "page.js"), "utf8");
  const data = JSON.stringify(pageData(model)).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Feature map</title>
<style>
${css}
</style>
</head>
<body>
<header class="top">
  <div class="title">
    <h1>Feature map</h1>
    <p id="totals" class="muted"></p>
  </div>
  <div class="controls">
    <input id="search" type="search" placeholder="Search pages, routes, files, tables, tools…" autocomplete="off" aria-label="Search">
    <button id="theme" type="button" aria-label="Toggle light or dark theme">Theme</button>
  </div>
  <nav class="tabs" aria-label="Views">
    <button type="button" data-view="features" class="active">Features</button>
    <button type="button" data-view="diagram">Dependency diagram</button>
    <button type="button" data-view="unassigned">Unassigned <span id="unassigned-count" class="pill"></span></button>
  </nav>
</header>
<main>
  <section id="view-features" class="view">
    <aside class="sidebar">
      <div class="chips" id="kind-filter">
        <label><input type="checkbox" value="feature" checked> Features</label>
        <label><input type="checkbox" value="infrastructure" checked> Infrastructure</label>
      </div>
      <ul id="feature-list"></ul>
    </aside>
    <article id="detail" class="detail"></article>
  </section>
  <section id="view-search" class="view" hidden>
    <div class="chips" id="type-filter"></div>
    <div id="results"></div>
  </section>
  <section id="view-diagram" class="view" hidden>
    <div class="diagram-bar">
      <label><input type="checkbox" id="show-infra"> Show shared infrastructure</label>
      <label><input type="checkbox" id="show-types"> Include type-only imports</label>
      <span class="muted">Arrows point from a feature to what it depends on. Hover a node to highlight its links; click it to open the feature.</span>
    </div>
    <div class="diagram-wrap"><svg id="diagram" role="img" aria-label="Dependencies between features"></svg></div>
    <div id="edge-info" class="muted"></div>
  </section>
  <section id="view-unassigned" class="view" hidden></section>
</main>
<script id="data" type="application/json">${data}</script>
<script>
${js}
</script>
</body>
</html>
`;
}
