import { describe, expect, it } from "vitest";

import { findServerOnly, SERVER_ONLY_PACKAGES } from "./server-only-check.mjs";

describe("findServerOnly", () => {
  const chunks = {
    "static/chunks/1-aaaa.js": [{ name: "node_modules/react-dom/index.js", size: 1 }, { name: "src/components/ui/card.tsx", size: 1 }],
    "static/chunks/2-bbbb.js": [{ name: "node_modules/swr/dist/index.mjs", size: 1 }, { name: "node_modules/openai/index.mjs", size: 1 }],
    "static/chunks/3-cccc.js": [{ name: "node_modules/@modelcontextprotocol/server/dist/index.mjs", size: 1 }],
  };

  it("names each server-only package found in a chunk, with the chunk and the module", () => {
    expect(findServerOnly(chunks)).toEqual([
      { package: "openai", chunk: "static/chunks/2-bbbb.js", module: "node_modules/openai/index.mjs" },
      { package: "@modelcontextprotocol/server", chunk: "static/chunks/3-cccc.js", module: "node_modules/@modelcontextprotocol/server/dist/index.mjs" },
    ]);
  });

  it("finds nothing in a clean build", () => {
    expect(findServerOnly({ "static/chunks/1-aaaa.js": chunks["static/chunks/1-aaaa.js"] })).toEqual([]);
  });

  it("matches the package, not a name that only starts with it", () => {
    expect(findServerOnly({ a: [{ name: "node_modules/openai-fetch/x.js", size: 1 }, { name: "node_modules/sharp-lite/x.js", size: 1 }, { name: "src/lib/ai/openai.ts", size: 1 }] })).toEqual([]);
  });

  it("watches the six packages the plan names", () => {
    expect(SERVER_ONLY_PACKAGES).toEqual(["openai", "unpdf", "web-push", "sharp", "fflate", "@modelcontextprotocol/server"]);
  });
});
